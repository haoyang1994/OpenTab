chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['icons', 'background', 'clockFormat', 'showSeconds'], (result) => {
    if (!result.icons) {
      chrome.storage.local.set({
        icons: [],
        background: {
          type: 'bing',
          value: ''
        },
        clockFormat: '12h',
        showSeconds: false,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        bingIndex: 0
      });
    }
  });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fetchBingImage') {
    const index = Number.isInteger(request.index) ? request.index : 0;
    const safeIndex = Math.max(0, Math.min(index, 7));
    const apiUrl = `https://www.bing.com/HPImageArchive.aspx?format=js&idx=${safeIndex}&n=1&mkt=zh-CN`;

    fetch(apiUrl)
      .then(response => {
        if (!response.ok) {
          throw new Error(`Bing API status ${response.status}`);
        }
        return response.json();
      })
      .then(data => {
        const image = data?.images?.[0];
        if (!image?.url) {
          throw new Error('Bing API response missing image url');
        }
        const absoluteUrl = image.url.startsWith('http')
          ? image.url
          : `https://www.bing.com${image.url}`;
        sendResponse({
          success: true,
          url: absoluteUrl,
          nextIndex: (safeIndex + 1) % 8
        });
      })
      .catch(error => {
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }
});
