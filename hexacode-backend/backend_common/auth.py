from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

import jwt
from fastapi import Depends, HTTPException, Request
from jwt import InvalidTokenError, PyJWKClient

from backend_common.settings import ServiceSettings

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class AuthContext:
    cognito_sub: str
    username: str | None
    email: str | None
    groups: tuple[str, ...]
    token_use: str | None
    claims: dict[str, Any]


class CognitoJWTValidator:
    def __init__(self, settings: ServiceSettings) -> None:
        self.settings = settings
        self._jwk_client = PyJWKClient(settings.cognito.jwks_url)

    def validate(self, token: str) -> AuthContext:
        signing_key = self._jwk_client.get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            issuer=self.settings.cognito.issuer,
            leeway=self.settings.cognito.jwt_leeway_seconds,
            options={"require": ["exp", "iat", "sub"], "verify_aud": False},
        )

        audience = claims.get("aud") or claims.get("client_id")
        if audience != self.settings.cognito.app_client_id:
            raise InvalidTokenError("Token audience does not match the configured Cognito app client.")

        token_use = claims.get("token_use")
        if token_use not in {None, "access", "id"}:
            raise InvalidTokenError("Unsupported Cognito token_use value.")

        raw_groups = claims.get("cognito:groups") or []
        if isinstance(raw_groups, str):
            groups = (raw_groups,)
        else:
            groups = tuple(str(group) for group in raw_groups)

        return AuthContext(
            cognito_sub=str(claims["sub"]),
            username=claims.get("cognito:username") or claims.get("username"),
            email=claims.get("email"),
            groups=groups,
            token_use=token_use,
            claims=dict(claims),
        )


def _extract_bearer_token(request: Request) -> str:
    authorization = request.headers.get("authorization", "")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="Bearer token is required.")
    return token.strip()


def require_authenticated_user(settings: ServiceSettings):
    validator = CognitoJWTValidator(settings)

    async def dependency(request: Request) -> AuthContext:
        token = _extract_bearer_token(request)
        try:
            context = validator.validate(token)
        except InvalidTokenError as exc:
            logger.warning("Rejected Cognito token: %s", exc)
            raise HTTPException(status_code=401, detail=f"Invalid Cognito token: {exc}.") from exc
        request.state.auth = context
        return context

    return Depends(dependency)
