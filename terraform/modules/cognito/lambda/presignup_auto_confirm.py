"""Pre-sign-up Lambda: auto-confirm and auto-verify email on user sign-up."""


def handler(event, context):
    """
    Confirm the user and auto-verify their email address.

    Cognito calls this Lambda after the user submits sign-up but before
    the user is created. Returning the event unchanged allows the sign-up
    to proceed with auto_verified_attributes = ["email"] in the user pool
    automatically marking the email as verified.
    """
    # Auto-confirm the user — Cognito will not send a confirmation code.
    event["response"]["autoConfirmUser"] = True

    # Mark email as verified so the user can immediately sign in.
    event["response"]["autoVerifyEmail"] = True

    return event
