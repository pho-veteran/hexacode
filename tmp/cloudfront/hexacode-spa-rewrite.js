function handler(event) {
  var request = event.request;
  var uri = request.uri || "/";

  if (uri === "/favicon.ico") {
    request.uri = "/favicon.svg";
    return request;
  }

  if (uri === "/" || uri === "/index.html") {
    return request;
  }

  if (uri.indexOf("/assets/") === 0) {
    return request;
  }

  var lastSlash = uri.lastIndexOf("/");
  var lastSegment = lastSlash >= 0 ? uri.substring(lastSlash + 1) : uri;
  var hasExtension = lastSegment.indexOf(".") !== -1;

  if (!hasExtension) {
    request.uri = "/index.html";
  }

  return request;
}
