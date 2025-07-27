/*
 * Customer-side tracking logic for Courier Tracker.
 *
 * Reads the trip ID from the query string, polls the driver’s location from
 * localStorage and displays it on a Leaflet map. Allows customers to send
 * destination updates back to the driver by writing to localStorage.
 */

// Parse trip ID from query params
const params = new URLSearchParams(window.location.search);
const tripId = params.get('trip');
if (!tripId) {
  alert('No trip specified. Please make sure you have a valid tracking link.');
}

let map;
let driverMarker;
const driverCoordsEl = document.getElementById('driverCoords');

function initMap() {
  // Default to a neutral position; will be updated when the driver broadcasts
  map = L.map('map').setView([0, 0], 2);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
  }).addTo(map);
  driverMarker = L.marker([0, 0], { draggable: false }).addTo(map);
}

// Poll driver location from localStorage
function pollDriverLocation() {
  if (!tripId) return;
  const data = localStorage.getItem('trip_' + tripId);
  if (!data) return;
  try {
    const { lat, lng } = JSON.parse(data);
    if (lat !== undefined && lng !== undefined) {
      driverMarker.setLatLng([lat, lng]);
      map.setView([lat, lng], 16);
      driverCoordsEl.textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    }
  } catch (e) {
    // ignore parse errors
  }
}

// Handle destination form submission
const destinationForm = document.getElementById('destinationForm');
destinationForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!tripId) return;
  const latInput = document.getElementById('latInput');
  const lngInput = document.getElementById('lngInput');
  const noteInput = document.getElementById('noteInput');
  const lat = parseFloat(latInput.value);
  const lng = parseFloat(lngInput.value);
  const note = noteInput.value.trim();
  if (isNaN(lat) || isNaN(lng)) {
    alert('Please enter valid coordinates.');
    return;
  }
  const destinationObj = { destination: { lat, lng, note } };
  localStorage.setItem('route_' + tripId, JSON.stringify(destinationObj));
  alert('Destination sent to driver!');
  // Optionally, clear form
  noteInput.value = '';
});

// Initialize when DOM ready
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  setInterval(pollDriverLocation, 1000);
});