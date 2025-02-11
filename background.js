let siteLimits = {}; // Stores user-defined time limits
let lastVisited = {}; // Stores the last visited timestamp of each site

// Load saved data from storage
(chrome.storage || browser.storage).sync.get(["siteLimits", "lastVisited"], function (data) {
    siteLimits = data.siteLimits || {};
    lastVisited = data.lastVisited || {};
});

// Track site visits
(chrome.tabs || browser.tabs).onUpdated.addListener(
  (_tabId, changeInfo, tab) => {
    if (changeInfo.status === "complete") {
      let site = (new URL(tab.url)).hostname;
      let now = Date.now();

      if (siteLimits[site]) {
        let maxvisit = siteLimits[site].maxvisit || 0;
        let minaway = siteLimits[site].minaway || 0;
        let lastTime = lastVisited[site] || 0;
        let timeDiff = (now - lastTime) / (1000 * 60); // Convert to minutes

        if (timeDiff > maxvisit) {
          if (timeDiff < (maxvisit + minaway)) {
            let remainingTime = Math.ceil((maxvisit + minaway) - timeDiff);
            (chrome.scripting || browser.scripting).executeScript({
              target: { tabId: tab.id },
              func: replacePageContent,
              args: [remainingTime],
            });
          } else {
            lastVisited[site] = now;
            (chrome.storage || browser.storage).sync.set({ lastVisited });
          }
        }
      }
    }
  },
);

// Function to replace the page content
function replacePageContent(remainingTime) {
  document.body.innerHTML = ""; // Clear existing content

  let container = document.createElement("div");
  container.style.textAlign = "center";
  container.style.fontFamily = "Arial, sans-serif";
  container.style.marginTop = "20%";

  let heading = document.createElement("h1");
  heading.textContent = "Get back to work!";

  let message = document.createElement("p");
  message.textContent = `Sorry, you can't see this page. Based on the anti-procrastination parameters you set in your profile, you'll be able to use the site again in ${remainingTime} minutes.`;

  container.appendChild(heading);
  container.appendChild(message);
  document.body.appendChild(container);
}
