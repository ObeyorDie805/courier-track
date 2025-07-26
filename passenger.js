/*
 * Passenger-side page for Party Bus & Limo Tracker
 *
 * Allows guests to send a new destination to the driver, request a restroom break,
 * or ask for an additional stop. Also displays the vehicle’s current location on a map.
 */

// Read trip ID from query string
const params = new URLSearchParams(window.location.search);
const tripId = params.get('trip');
if (!tripId) {
  alert('No trip specified. Please use the tracking link provided by your chauffeur.');
}

// Initialise map and marker
let map;
let driverMarker;
function initMap() {
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
    }
  } catch (e) {
    // Ignore parse errors
  }
}

// Handle new destination form
// When the passenger submits an address or place name, we geocode it using
// OpenStreetMap's Nominatim service. If a result is found, the latitude and
// longitude are extracted and sent to the driver via localStorage. If the
// address cannot be geocoded, the passenger is informed.
const newDestinationForm = document.getElementById('newDestinationForm');
newDestinationForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!tripId) return;
  const address = document.getElementById('addressInput').value.trim();
  const note = document.getElementById('newNote').value.trim();
  if (!address) {
    alert('Please enter an address or place name.');
    return;
  }
  try {
    // Use Nominatim to geocode the address. Limit results to 1 for efficiency.
    const query = encodeURIComponent(address);
    const url = `https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=1`;
    const response = await fetch(url, {
      headers: {
        // Provide a User‑Agent header to comply with Nominatim usage policy.
        'User-Agent': 'PartyBusLimoTracker/1.0 (example@example.com)',
        'Accept-Language': 'en',
      },
    });
    if (!response.ok) {
      throw new Error('Network response was not ok');
    }
    const results = await response.json();
    if (!Array.isArray(results) || results.length === 0) {
      alert('Address not found. Please try a different address or check the spelling.');
      return;
    }
    const { lat, lon } = results[0];
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lon);
    if (isNaN(latNum) || isNaN(lngNum)) {
      alert('Unable to geocode the address.');
      return;
    }
    const payload = {
      destination: { lat: latNum, lng: lngNum, note },
      type: 'new_destination',
    };
    localStorage.setItem('route_' + tripId, JSON.stringify(payload));
    alert('New destination sent!');
    document.getElementById('addressInput').value = '';
    document.getElementById('newNote').value = '';
  } catch (err) {
    console.error(err);
    alert('An error occurred while looking up the address. Please try again.');
  }
});

// Handle special request buttons
document.getElementById('restroomBtn').addEventListener('click', () => {
  if (!tripId) return;
  localStorage.setItem('route_' + tripId, JSON.stringify({ type: 'restroom' }));
  alert('Restroom break requested!');
});

document.getElementById('stopBtn').addEventListener('click', () => {
  if (!tripId) return;
  localStorage.setItem('route_' + tripId, JSON.stringify({ type: 'stop' }));
  alert('Stop requested!');
});

// Initialise map and set polling
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  setInterval(pollDriverLocation, 1000);
});