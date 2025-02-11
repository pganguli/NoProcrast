document.getElementById("save").addEventListener("click", saveSiteLimits);
document.addEventListener("DOMContentLoaded", loadSites);

// Function to save site limits
function saveSiteLimits() {
  let site = document.getElementById("site").value;
  let maxvisit = parseInt(document.getElementById("maxvisit").value);
  let minaway = parseInt(document.getElementById("minaway").value);

  if (site && maxvisit > 0 && minaway > 0) {
    (chrome.storage || browser.storage).sync.get(["siteLimits"], function (data) {
        let siteLimits = data.siteLimits || {};
        siteLimits[site] = {maxvisit: maxvisit, minaway: minaway};
        (chrome.storage || browser.storage).sync.set({ siteLimits }, function () {
            loadSites(); // Update the table immediately after saving
        });
    });
  }
}

// Function to load sites in options.js
function loadSites() {
  (chrome.storage || browser.storage).sync.get(["siteLimits"], function (data) {
    let siteList = document.getElementById("siteList");
    siteList.innerHTML = "";

    let siteTable = document.getElementById("siteTable");
    if (!data.siteLimits || Object.keys(data.siteLimits).length === 0) {
      siteTable.style.display = "none";
      return;
    }
    siteTable.style.display = "table";

    let entries = Object.entries(data.siteLimits);
    entries.reverse(); // Reverse to show latest entry first

    for (let [site, {maxvisit, minaway}] of entries) {
      let row = document.createElement("tr");

      let siteCell = document.createElement("td");
      siteCell.textContent = site;

      let maxvisitCell = document.createElement("td");
      maxvisitCell.textContent = maxvisit;

      let minawayCell = document.createElement("td");
      minawayCell.textContent = minaway;

      row.appendChild(siteCell);
      row.appendChild(maxvisitCell);
      row.appendChild(minawayCell);
      siteList.appendChild(row);
    }
  });
}
