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

// SMS notification state
let smsSent = false; // whether initial tracking link SMS has been sent
let tenMinuteNotified = false; // whether the "10 minutes away" notification has been sent
let arrivalNotified = false; // whether the arrival notification has been sent

// DOM element for phone input (optional)
const phoneInput = document.getElementById('phoneInput');

// Helper: compute the great-circle distance between two points (Haversine formula)
function haversineDistanceMiles(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 3958.8; // Earth radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Distance thresholds for SMS notifications (in miles). Adjust as needed for
// your typical driving speeds. At roughly 30 mph, 10 minutes corresponds to
// about 5 miles, and arrival is considered within 0.1 miles (~500 feet).
const TEN_MINUTES_DISTANCE_MILES = 5;
const ARRIVAL_DISTANCE_MILES = 0.1;

// Placeholder function to send SMS via Twilio's REST API. You must provide your own
// Twilio Account SID, Auth Token, and a valid Twilio phone number. For security,
// store these credentials on the server side or within environment variables.
async function sendSms(to, message) {
  // TODO: Replace the placeholders below with your Twilio credentials. Do not
  // commit real credentials to source control.
  const accountSid = 'YOUR_TWILIO_ACCOUNT_SID';
  const authToken = 'YOUR_TWILIO_AUTH_TOKEN';
  const fromNumber = 'YOUR_TWILIO_PHONE_NUMBER';
  if (!accountSid || !authToken || !fromNumber) {
    console.warn('Twilio credentials not configured. SMS will not be sent.');
    return;
  }
  const body = new URLSearchParams();
  body.append('To', to);
  body.append('From', fromNumber);
  body.append('Body', message);
  const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + btoa(`${accountSid}:${authToken}`),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (!resp.ok) {
    console.error('Failed to send SMS', await resp.text());
  }
}

// DOM elements for driver app and authentication
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const generateLinkBtn = document.getElementById('generateLinkBtn');
const copyLinkBtn = document.getElementById('copyLinkBtn');
const linkInput = document.getElementById('linkInput');
const destinationDisplay = document.getElementById('destinationDisplay');
const authContainer = document.getElementById('authContainer');
const appContainer = document.getElementById('appContainer');
const signUpForm = document.getElementById('signUpForm');
const loginForm = document.getElementById('loginForm');
const driverWelcome = document.getElementById('driverWelcome');

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

// Show or hide app/auth sections depending on login state
function showApp() {
  if (authContainer) authContainer.style.display = 'none';
  if (appContainer) appContainer.style.display = 'block';
  // Update welcome message with driver name if available
  const current = getCurrentDriver();
  if (current && driverWelcome) {
    driverWelcome.textContent = `Welcome, ${current.firstName}! Track your party bus or limo in real time`;
  }
}

function showAuth() {
  if (appContainer) appContainer.style.display = 'none';
  if (authContainer) authContainer.style.display = 'block';
}

function getCurrentDriver() {
  try {
    return JSON.parse(localStorage.getItem('currentDriver'));
  } catch (e) {
    return null;
  }
}

function saveDrivers(drivers) {
  localStorage.setItem('drivers', JSON.stringify(drivers));
}

function getDrivers() {
  try {
    return JSON.parse(localStorage.getItem('drivers')) || [];
  } catch (e) {
    return [];
  }
}

function setCurrentDriver(driver) {
  localStorage.setItem('currentDriver', JSON.stringify(driver));
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

  // If a phone number is provided and the share link has been generated, send the initial SMS
  if (!smsSent && phoneInput && phoneInput.value && linkInput.value) {
    const msg = `Your party bus or limo is on its way! Track your ride here: ${linkInput.value}`;
    sendSms(phoneInput.value, msg).catch((err) => console.error(err));
    smsSent = true;
  }
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
  // Build a share link that points to passenger.html and includes the driver code
  const current = getCurrentDriver();
  const url = new URL(window.location.origin + '/passenger.html');
  url.searchParams.set('trip', currentTripId);
  if (current && current.passcode) {
    url.searchParams.set('code', current.passcode);
  }
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

  // Reset SMS notification flags for the new trip
  smsSent = false;
  tenMinuteNotified = false;
  arrivalNotified = false;
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
  if (routeData) {
    // Handle special request types
    if (routeData.type && !routeData.destination) {
      // Clear any existing destination marker
      if (destinationMarker) {
        map.removeLayer(destinationMarker);
        destinationMarker = null;
      }
      if (routeData.type === 'restroom') {
        // For restroom requests, attempt to find the nearest gas station and
        // automatically set it as the new destination. This uses OpenStreetMap’s
        // Nominatim search to find a gas station near the driver’s current
        // location. The search is performed only once per request; subsequent
        // polls will display the destination once it’s been set.
        destinationDisplay.textContent = 'Restroom break requested – finding nearest gas station...';
        // Initiate lookup if not already processing
        if (!pollRouteUpdates.processingRestroom) {
          pollRouteUpdates.processingRestroom = true;
          // Retrieve the driver’s current coordinates from trip data
          const tripRaw = localStorage.getItem('trip_' + currentTripId);
          let coords;
          try {
            coords = JSON.parse(tripRaw);
          } catch (e) {
            coords = null;
          }
          if (coords && coords.lat !== undefined && coords.lng !== undefined) {
            const { lat, lng } = coords;
            findNearestGasStation(lat, lng)
              .then(({ lat: destLat, lng: destLng, name }) => {
                // Construct a new payload with destination and note
                const newPayload = {
                  type: 'restroom',
                  destination: { lat: destLat, lng: destLng, note: name || 'Nearest gas station' },
                };
                localStorage.setItem('route_' + currentTripId, JSON.stringify(newPayload));
                destinationDisplay.textContent = 'Nearest gas station set as destination';
              })
              .catch((error) => {
                console.error('Failed to find gas station:', error);
                destinationDisplay.textContent = 'Restroom break requested (unable to find station)';
              })
              .finally(() => {
                pollRouteUpdates.processingRestroom = false;
              });
          } else {
            // Couldn’t get current location; just notify driver
            destinationDisplay.textContent = 'Restroom break requested (no location available)';
            pollRouteUpdates.processingRestroom = false;
          }
        }
      } else if (routeData.type === 'stop') {
        destinationDisplay.textContent = 'Stop requested!';
      } else {
        destinationDisplay.textContent = `Request: ${routeData.type}`;
      }
    } else if (routeData.destination) {
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

      // After updating the destination marker, check if we should send proximity SMS notifications
      // Only proceed if the initial SMS has been sent and we have a phone number
      if (smsSent && phoneInput && phoneInput.value) {
        // Obtain the driver's current location from localStorage
        const tripRaw = localStorage.getItem('trip_' + currentTripId);
        let coords;
        try {
          coords = JSON.parse(tripRaw);
        } catch (e) {
          coords = null;
        }
        if (coords && coords.lat !== undefined && coords.lng !== undefined) {
          const dist = haversineDistanceMiles(coords.lat, coords.lng, lat, lng);
          // If within ten minutes threshold and not yet notified
          if (!tenMinuteNotified && dist <= TEN_MINUTES_DISTANCE_MILES) {
            tenMinuteNotified = true;
            const msg = 'Your party bus or limo is about 10 minutes away!';
            sendSms(phoneInput.value, msg).catch((err) => console.error(err));
          }
          // If within arrival threshold and not yet notified
          if (!arrivalNotified && dist <= ARRIVAL_DISTANCE_MILES) {
            arrivalNotified = true;
            const msg = 'Your party bus or limo has arrived!';
            sendSms(phoneInput.value, msg).catch((err) => console.error(err));
          }
        }
      }
    }
  }
}

// Utility to find the nearest gas station to a given coordinate using Nominatim
// Returns a promise that resolves with { lat, lng, name }
async function findNearestGasStation(lat, lng) {
  // Build a search query for a gas station near the given coordinates. We
  // include the coordinates in the query string so Nominatim biases results to
  // that area. Limit results to 1.
  const query = `gas station near ${lat},${lng}`;
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'PartyBusLimoTracker/1.0 (example@example.com)',
      'Accept-Language': 'en',
    },
  });
  if (!response.ok) {
    throw new Error('Network response not ok');
  }
  const results = await response.json();
  if (!Array.isArray(results) || results.length === 0) {
    throw new Error('No gas station found');
  }
  const { lat: destLat, lon: destLon, display_name } = results[0];
  return { lat: parseFloat(destLat), lng: parseFloat(destLon), name: display_name };
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

  // Authentication logic: show login/signup or app based on stored state
  const current = getCurrentDriver();
  if (current) {
    showApp();
  } else {
    showAuth();
  }

  // Sign-up form handler
  if (signUpForm) {
    signUpForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const firstName = document.getElementById('signUpFirst').value.trim();
      const lastName = document.getElementById('signUpLast').value.trim();
      const pass = document.getElementById('signUpPass').value.trim();
      if (!firstName || !lastName || !/^\d{4}$/.test(pass)) {
        alert('Please enter your first name, last name, and a 4-digit passcode.');
        return;
      }
      const drivers = getDrivers();
      // Check for duplicate passcode
      const exists = drivers.some((d) => d.passcode === pass);
      if (exists) {
        alert('That passcode is already taken. Please choose a different 4-digit code.');
        return;
      }
      const driver = { firstName, lastName, passcode: pass };
      drivers.push(driver);
      saveDrivers(drivers);
      setCurrentDriver(driver);
      // Clear form fields
      document.getElementById('signUpFirst').value = '';
      document.getElementById('signUpLast').value = '';
      document.getElementById('signUpPass').value = '';
      showApp();
    });
  }

  // Login form handler
  if (loginForm) {
    loginForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const pass = document.getElementById('loginPass').value.trim();
      if (!/^\d{4}$/.test(pass)) {
        alert('Please enter your 4-digit passcode.');
        return;
      }
      const drivers = getDrivers();
      const driver = drivers.find((d) => d.passcode === pass);
      if (!driver) {
        alert('No account found for that code. Please sign up or check your passcode.');
        return;
      }
      setCurrentDriver(driver);
      // Clear login field
      document.getElementById('loginPass').value = '';
      showApp();
    });
  }
});