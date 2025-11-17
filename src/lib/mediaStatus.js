export function deriveMediaInfoStatuses(mediaInfo) {
  const availability =
    typeof mediaInfo?.status === 'number' ? mediaInfo.status : null;

  if (!Array.isArray(mediaInfo?.requests) || mediaInfo.requests.length === 0) {
    return { availability, requestStatus: null };
  }

  const sorted = mediaInfo.requests
    .map((request) => {
      const time = new Date(request?.createdAt || 0).getTime();
      return {
        request,
        time: Number.isFinite(time) ? time : 0
      };
    })
    .sort((a, b) => b.time - a.time);

  let requestStatus = null;
  for (const entry of sorted) {
    const status = entry?.request?.status;
    if (typeof status === 'number') {
      requestStatus = status;
      break;
    }
  }

  return { availability, requestStatus };
}
