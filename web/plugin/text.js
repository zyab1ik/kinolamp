export function escapeText(value) {
  return String(value == null ? '' : value).replace(
    /[&<>"']/g,
    function (char) {
      return {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[char];
    }
  );
}
export function encodeForm(values) {
  return Object.keys(values)
    .map(function (key) {
      return encodeURIComponent(key) + '=' + encodeURIComponent(values[key]);
    })
    .join('&');
}
export function httpsURL(raw) {
  // ES5-compatible validation. No URL constructor required on older televisions.
  // eslint-disable-next-line no-control-regex -- Reject control characters in stream URLs.
  if (typeof raw !== 'string' || /[\s\\\u0000-\u001f\u007f]/.test(raw)) {
    return false;
  }
  return /^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d{1,5})?(?:[/?][^#]*)?$/i.test(
    raw
  );
}
