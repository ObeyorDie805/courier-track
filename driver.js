/*
 * Driver-side logic for Courier Tracker.
 *
 * Uses the browser's Geolocation API to watch the driver's location and
 * broadcasts it by storing coordinates in localStorage. Creates a unique
 * shareable link for customers to view the driver's progress. Polls for
 * destination updates set by customers on the tracking page.
 */

// Leaflet map and marker variables
let map;
let driverMarker;
let destinationMarker;
let watchId = null;
let currentTripId = null;

// DOM elements
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const generateLinkBtn = document.getElementById('generateLinkBtn');
const copyLinkBtn = document.getElementById('copyLinkBtn');
const linkInput = document.getElementById('linkInput');
const destinationDisplay = document.getElementById('destinationDisplay');

// Initialize the map on page load
function initMap() {
  // Default view somewhere central; will be updated when geolocation is available
  map = L.map('map').setView([37.7749, -122.4194], 12); // San Francisco as fallback
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
  }).addTo(map);
  driverMarker = L.marker([37.7749, -122.4194], { draggable: false }).addTo(map);
}

// Start watching the driver's location
function startTracking() {
  if (!currentTripId) {
    alert('Please generate a shareable link before starting the trip.');
    return;
  }
  if (watchId !== null) return; // Already tracking
  if (!navigator.geolocation) {
    alert('Geolocation is not supported by your browser.');
    return;
  }
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      // Update map and marker
      driverMarker.setLatLng([lat, lng]);
      map.setView([lat, lng], 16);
      // Persist data to localStorage for tracking page
      const tripData = { lat, lng };
      localStorage.setItem('trip_' + currentTripId, JSON.stringify(tripData));
    },
    (err) => {
      console.error(err);
      alert('Unable to retrieve your location. Please ensure location access is allowed.');
    },
    {
      enableHighAccuracy: true,
      maximumAge: 1000,
      timeout: 10000,
    },
  );
  // Toggle buttons
  startBtn.disabled = true;
  stopBtn.disabled = false;
}

// Stop watching the driver's location
function stopTracking() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
    startBtn.disabled = false;
    stopBtn.disabled = true;
  }
}

// Generate a unique link for the current trip
function generateShareLink() {
  // If a trip is already active, inform the driver
  if (currentTripId) {
    if (!confirm('A trip is already in progress. Generating a new link will overwrite the existing trip. Continue?')) {
      return;
    }
    // Remove any previous data
    localStorage.removeItem('trip_' + currentTripId);
    localStorage.removeItem('route_' + currentTripId);
  }
  currentTripId = Date.now().toString(36); // base36 timestamp
  const url = new URL(window.location.origin + '/track.html');
  url.searchParams.set('trip', currentTripId);
  linkInput.value = url.toString();
  copyLinkBtn.disabled = false;
  // Reset destination display
  destinationDisplay.textContent = 'None';
  // Remove any existing destination marker
  if (destinationMarker) {
    map.removeLayer(destinationMarker);
    destinationMarker = null;
  }
  // Save empty route
  localStorage.setItem('route_' + currentTripId, JSON.stringify(null));
}

// Copy the generated link to clipboard
async function copyLink() {
  try {
    await navigator.clipboard.writeText(linkInput.value);
    copyLinkBtn.textContent = 'Copied!';
    setTimeout(() => {
      copyLinkBtn.textContent = 'Copy';
    }, 2000);
  } catch (err) {
    console.error(err);
    alert('Unable to copy link');
  }
}

// Poll for route updates from the tracking page
function pollRouteUpdates() {
  if (!currentTripId) return;
  const routeDataRaw = localStorage.getItem('route_' + currentTripId);
  if (!routeDataRaw) return;
  let routeData;
  try {
    routeData = JSON.parse(routeDataRaw);
  } catch (e) {
    return;
  }
  if (routeData && routeData.destination) {
    const { lat, lng, note } = routeData.destination;
    destinationDisplay.textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}${note ? ' – ' + note : ''}`;
    if (!destinationMarker) {
      destinationMarker = L.marker([lat, lng], { icon: L.icon({
          iconUrl: 'https://unpkg.com/leaflet@1.9.3/dist/images/marker-icon.png',
          iconSize: [25, 41],
          iconAnchor: [12, 41],
          popupAnchor: [1, -34],
          shadowUrl: 'https://unpkg.com/leaflet@1.9.3/dist/images/marker-shadow.png',
        })
      }).addTo(map);
    } else {
      destinationMarker.setLatLng([lat, lng]);
    }
  }
}

// Attach event listeners
startBtn.addEventListener('click', startTracking);
stopBtn.addEventListener('click', stopTracking);
generateLinkBtn.addEventListener('click', generateShareLink);
copyLinkBtn.addEventListener('click', copyLink);

// Initialize map on load
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  // Poll for route updates every second
  setInterval(pollRouteUpdates, 1000);
});