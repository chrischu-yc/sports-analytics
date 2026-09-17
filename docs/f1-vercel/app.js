const yearSelect = document.querySelector("#year");
const raceSelect = document.querySelector("#race");
const loadButton = document.querySelector("#load-race");
const notice = document.querySelector("#notice");
const statusText = document.querySelector("#status span");
const statusPill = document.querySelector("#status");

const currentYear = new Date().getFullYear();
for (let year = currentYear; year >= 2018; year -= 1) {
  yearSelect.add(new Option(String(year), String(year)));
}

yearSelect.addEventListener("change", loadRaces);
raceSelect.addEventListener("change", () => {
  loadButton.disabled = !raceSelect.value;
});
loadButton.addEventListener("click", loadSummary);

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab, .tab-panel").forEach((item) => item.classList.remove("active"));
    tab.classList.add("active");
    document.querySelector(`#${tab.dataset.tab}`).classList.add("active");
  });
});

async function loadRaces() {
  raceSelect.disabled = true;
  loadButton.disabled = true;
  setStatus("Loading calendar", true);
  try {
    const response = await fetch(`/api/f1?action=races&year=${yearSelect.value}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Could not load the calendar.");
    raceSelect.replaceChildren(...payload.races.map((race) => new Option(`${race.round.toString().padStart(2, "0")}  ${race.name}`, race.name)));
    raceSelect.disabled = false;
    loadButton.disabled = !raceSelect.value;
    setStatus("Session ready", false);
    setNotice(`${payload.races.length} sessions available for ${yearSelect.value}.`);
  } catch (error) {
    setStatus("Request failed", false);
    setNotice(error.message, true);
  }
}

async function loadSummary() {
  const year = yearSelect.value;
  const race = raceSelect.value;
  loadButton.disabled = true;
  setStatus("Loading FastF1", true);
  setNotice("Fetching the race session. This can take a moment...");
  try {
    const response = await fetch(`/api/f1?action=summary&year=${year}&race=${encodeURIComponent(race)}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Could not load this session.");
    renderSummary(payload);
    setStatus("Session loaded", false);
    setNotice("Session data loaded successfully.");
  } catch (error) {
    setStatus("Session unavailable", false);
    setNotice(error.message, true);
  } finally {
    loadButton.disabled = !raceSelect.value;
  }
}

function renderSummary(data) {
  document.querySelector("#session-title").textContent = data.title;
  document.querySelector("#session-subtitle").textContent = "Race classification and core timing data from FastF1.";
  document.querySelector("#driver-count").textContent = data.drivers;
  document.querySelector("#lap-count").textContent = data.laps.toLocaleString();
  document.querySelector("#fastest-driver").textContent = data.fastest_lap?.driver || "--";
  document.querySelector("#fastest-time").textContent = data.fastest_lap?.time || "Unavailable";
  document.querySelector("#results-body").innerHTML = data.results.map((result) => `
    <tr><td>${result.position ?? "--"}</td><td class="driver-code">${escapeHtml(result.driver)}</td><td>${escapeHtml(result.name)}</td><td>${escapeHtml(result.team)}</td></tr>
  `).join("");
}

function setStatus(message, loading) {
  statusText.textContent = message;
  statusPill.classList.toggle("loading", loading);
}

function setNotice(message, error = false) {
  notice.textContent = message;
  notice.classList.toggle("error", error);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]);
}

loadRaces();
