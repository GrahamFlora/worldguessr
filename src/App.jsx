import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, updateDoc, onSnapshot } from 'firebase/firestore';
import { Globe, Users, Trophy, ArrowRight, Home, Map as MapIcon, Minimize2, Copy, CheckCircle, RotateCcw, User, Clock, MapPin, List, X, ChevronRight, Sparkles, Eye, EyeOff, Navigation, Search, Radar } from 'lucide-react';

// --- CONFIGURATION ---
const GOOGLE_MAPS_API_KEY = "AIzaSyClIIqqJnkI-7BviXgT4oB44nBtSF6FkNI"; 

// Global variables provided by the environment
const appId = typeof __app_id !== 'undefined' ? __app_id : 'worldguessr-online-v2';
const firebaseConfig = typeof __firebase_config !== 'undefined' 
  ? JSON.parse(__firebase_config) 
  : {
      apiKey: "AIzaSyBZf1hAPA_ozUE1UYS_LZy9CaEpj-WgEwM",
      authDomain: "worldguessr-a22f6.firebaseapp.com",
      projectId: "worldguessr-a22f6",
      storageBucket: "worldguessr-a22f6.firebasestorage.app",
      messagingSenderId: "135358594294",
      appId: "1:135358594294:web:ad349693defaed56d640d7",
    };

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Helper for Mandatory Pathing Rule
const getRoomRef = (code) => doc(db, 'artifacts', appId, 'public', 'data', 'rooms', code);

// --- UTILS & FAST LOCATION ENGINE ---
let GOOGLE_PROMISE = null;
const loadGoogleMaps = () => {
  if (GOOGLE_PROMISE) return GOOGLE_PROMISE;
  
  GOOGLE_PROMISE = new Promise((resolve, reject) => {
    if (window.google && window.google.maps) {
      return resolve(window.google);
    }
    
    const existingScript = document.querySelector('script[src*="maps.googleapis.com/maps/api/js"]');
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(window.google));
      existingScript.addEventListener('error', (err) => reject(err));
      return;
    }

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=geometry`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.google && window.google.maps) resolve(window.google);
      else reject(new Error("Google Maps Namespace missing"));
    };
    script.onerror = (err) => {
      GOOGLE_PROMISE = null; 
      reject(err);
    };
    document.head.appendChild(script);
  });
  return GOOGLE_PROMISE;
};

const KNOWN_LOCATIONS_WORLD = [
  {lat: 48.8584, lng: 2.2945}, {lat: 40.6892, lng: -74.0445}, {lat: -33.8568, lng: 151.2153},
  {lat: -22.9519, lng: -43.2105}, {lat: 35.3606, lng: 138.7274}, {lat: 29.9792, lng: 31.1342},
  {lat: 41.8902, lng: 12.4922}, {lat: 27.1751, lng: 78.0421}, {lat: -13.1631, lng: -72.5450},
  {lat: 36.3932, lng: 25.4615}, {lat: 25.1972, lng: 55.2744}, {lat: 51.1789, lng: -1.8262},
  {lat: 37.8199, lng: -122.4783}, {lat: 30.3285, lng: 35.4444}, {lat: 13.4125, lng: 103.8670},
  {lat: 14.5995, lng: 120.9842}, {lat: 10.3157, lng: 123.8854}, {lat: 35.6762, lng: 139.6503},
  {lat: 37.5665, lng: 126.9780}, {lat: -37.8136, lng: 144.9631}, {lat: 34.0522, lng: -118.2437},
  {lat: 51.5074, lng: -0.1278}, {lat: 52.5200, lng: 13.4050}, {lat: -23.5505, lng: -46.6333},
  {lat: -34.6037, lng: -58.3816}, {lat: -33.9249, lng: 18.4241}, {lat: 1.3521, lng: 103.8198}
];

const PH_BOUNDS = { minLat: 4.5, maxLat: 21.5, minLng: 116.0, maxLng: 127.0 };

const getRandomStreetViewLocation = (svService, region = 'world', google, customCoord = null) => {
  return new Promise((resolve) => {
    let tries = 0;
    const attempt = () => {
      tries++;
      let lat, lng;
      
      if (customCoord) {
        lat = customCoord.lat;
        lng = customCoord.lng;
      } else if (region === 'philippines') {
        lat = PH_BOUNDS.minLat + Math.random() * (PH_BOUNDS.maxLat - PH_BOUNDS.minLat);
        lng = PH_BOUNDS.minLng + Math.random() * (PH_BOUNDS.maxLng - PH_BOUNDS.minLng);
      } else {
        const pool = KNOWN_LOCATIONS_WORLD;
        const base = pool[Math.floor(Math.random() * pool.length)];
        lat = base.lat + (Math.random() - 0.5) * 0.5;
        lng = base.lng + (Math.random() - 0.5) * 0.5;
      }

      svService.getPanorama({ 
        location: {lat, lng}, 
        radius: customCoord ? 50000 : 50000, 
        source: google.maps.StreetViewSource.OUTDOOR 
      }, (data, status) => {
        if (status === 'OK' && data && data.location && data.location.latLng) {
          resolve({ lat: data.location.latLng.lat(), lng: data.location.latLng.lng(), pano: data.location.pano });
        } else {
          if (tries < 35 && !customCoord) setTimeout(attempt, 10);
          else if (customCoord) resolve({ lat: customCoord.lat, lng: customCoord.lng, pano: null }); // Fallback to raw map if no StreetView for custom coordinate
          else {
            const finalFallback = region === 'philippines' ? {lat: 14.5995, lng: 120.9842} : {lat: 48.8584, lng: 2.2945};
            resolve({ ...finalFallback, pano: null });
          }
        }
      });
    };
    attempt();
  });
};

const calculateDistance = (lat1, lon1, lat2, lon2) => {
  if (window.google?.maps?.geometry) {
    const p1 = new window.google.maps.LatLng(lat1, lon1);
    const p2 = new window.google.maps.LatLng(lat2, lon2);
    return window.google.maps.geometry.spherical.computeDistanceBetween(p1, p2) / 1000; 
  }
  return 0;
};

const calculateScore = (distanceKm) => {
  if (distanceKm <= 15) return 5000;
  const score = 5000 * Math.exp(-distanceKm / 3000); 
  return Math.max(0, Math.round(score));
};

const getAvatarUrl = (seed) => `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(seed)}&backgroundColor=0f172a&radius=50`;
const generateRoomCode = () => Math.random().toString(36).substring(2, 6).toUpperCase();
const getPlayerColor = (index, totalPlayers) => `hsl(${Math.floor((index / (totalPlayers || 1)) * 360)}, 85%, 60%)`;

// --- COMPONENTS ---
const StreetView = ({ location }) => {
  const containerRef = useRef(null);
  const svInstance = useRef(null);

  useEffect(() => {
    if (!location) return; // SAFE GUARD
    let isMounted = true;
    loadGoogleMaps().then((google) => {
      if (!isMounted || !containerRef.current) return;

      if (!svInstance.current) {
         svInstance.current = new google.maps.StreetViewPanorama(containerRef.current, {
             pov: { heading: 0, pitch: 0 }, zoom: 1, addressControl: false, showRoadLabels: false,
             fullscreenControl: false, zoomControl: false, panControl: false, enableCloseButton: false,
             clickToGo: true, disableDefaultUI: false, linksControl: true, scrollwheel: true, keyboardShortcuts: true 
         });
      }
      if (location.pano) svInstance.current.setPano(location.pano);
      else svInstance.current.setPosition({ lat: location.lat, lng: location.lng });
    }).catch(err => console.error("Google Maps Failed to Load:", err));

    return () => { isMounted = false; };
  }, [location]);

  return <div ref={containerRef} className="w-full h-full bg-slate-950 focus:outline-none" tabIndex="0" style={{ pointerEvents: 'auto' }} />;
};

const GoogleMapCanvas = ({ interactable, actualLocation, guesses, activeGuess, activeGuessAvatar, onGuessChange, isExpanded }) => {
  const mapContainerRef = useRef(null);
  const mapInstance = useRef(null);
  const markersRef = useRef([]);
  const polylinesRef = useRef([]);

  useEffect(() => {
    let isMounted = true;

    loadGoogleMaps().then((google) => {
      if (!isMounted || !mapContainerRef.current) return;

      if (!mapInstance.current) {
        mapInstance.current = new google.maps.Map(mapContainerRef.current, {
          center: { lat: 20, lng: 0 }, zoom: 2, minZoom: 2, streetViewControl: false, mapTypeControl: false,
          fullscreenControl: false, scrollwheel: true, gestureHandling: "greedy", zoomControl: true,
          zoomControlOptions: { position: google.maps.ControlPosition.RIGHT_TOP },
          styles: [
            { featureType: "poi", stylers: [{ visibility: "off" }] },
            { featureType: "transit", stylers: [{ visibility: "off" }] }
          ]
        });
      }

      const map = mapInstance.current;
      markersRef.current.forEach(m => m.setMap(null));
      polylinesRef.current.forEach(p => p.setMap(null));
      markersRef.current = [];
      polylinesRef.current = [];

      // Dark stroke added for contrast against bright map
      const createPin = (color) => ({ path: google.maps.SymbolPath.CIRCLE, fillColor: color, fillOpacity: 1, strokeWeight: 2, strokeColor: '#000000', scale: 8 });

      if (interactable) {
        google.maps.event.clearListeners(map, 'click');
        map.addListener('click', (e) => onGuessChange({ lat: e.latLng.lat(), lng: e.latLng.lng() }));
        if (activeGuess) {
          const icon = activeGuessAvatar ? { url: activeGuessAvatar, scaledSize: new google.maps.Size(40, 40), anchor: new google.maps.Point(20, 20) } : createPin('#38bdf8');
          markersRef.current.push(new google.maps.Marker({ position: activeGuess, map, icon }));
        }
      } else if (actualLocation && actualLocation.lat) {
        google.maps.event.clearListeners(map, 'click'); 
        const actualPos = { lat: actualLocation.lat, lng: actualLocation.lng };
        markersRef.current.push(new google.maps.Marker({ position: actualPos, map, icon: createPin('#34d399'), zIndex: 999 }));
        const bounds = new google.maps.LatLngBounds();
        bounds.extend(actualPos);

        if (guesses && guesses.length > 0) {
          guesses.forEach((guess) => {
            if (!guess || guess.lat === null) return; 
            const pos = { lat: guess.lat, lng: guess.lng };
            const icon = guess.avatar ? { url: guess.avatar, scaledSize: new google.maps.Size(36, 36), anchor: new google.maps.Point(18, 18) } : createPin(guess.color);
            markersRef.current.push(new google.maps.Marker({ position: pos, map, icon: icon, title: guess.label }));
            
            const lineSymbol = { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 3 };
            polylinesRef.current.push(new google.maps.Polyline({ 
              path: [pos, actualPos], geodesic: true, strokeColor: guess.color || '#3b82f6', strokeOpacity: 0, strokeWeight: 3, 
              icons: [{ icon: lineSymbol, offset: '0', repeat: '20px' }], map 
            }));
            bounds.extend(pos);
          });
        }
        map.fitBounds(bounds);
      }
    }).catch(err => console.error(err));

    return () => { isMounted = false; };
  }, [interactable, actualLocation, guesses, activeGuess, activeGuessAvatar, isExpanded]);

  return <div ref={mapContainerRef} className="absolute inset-0 bg-[#e3f0f7]" onWheel={(e) => e.stopPropagation()} style={{ pointerEvents: 'auto' }} />;
};

// Interactive Map for Custom Pin Dropping in the Main Menu
const CustomMapSelector = ({ locations, setLocations, maxRounds }) => {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [mapError, setMapError] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    let isMounted = true;
    loadGoogleMaps().then(google => {
      if (!isMounted || !mapContainerRef.current) return;
      
      if (!mapInstanceRef.current) {
        mapInstanceRef.current = new google.maps.Map(mapContainerRef.current, {
          center: { lat: 20, lng: 0 },
          zoom: 1,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          gestureHandling: "greedy", // Fixes the "Ctrl + Scroll" issue
          minZoom: 1
        });

        const svService = new google.maps.StreetViewService();

        mapInstanceRef.current.addListener('click', (e) => {
          setMapError('');
          // Snap pin to nearest street view to prevent black screens!
          svService.getPanorama({ location: e.latLng, radius: 50000, source: google.maps.StreetViewSource.OUTDOOR }, (data, status) => {
            if (status === 'OK' && data.location && data.location.latLng) {
               setLocations(prev => {
                 if (prev.length >= maxRounds) return prev;
                 return [...prev, { lat: data.location.latLng.lat(), lng: data.location.latLng.lng() }];
               });
            } else {
               setMapError('No Street View coverage near this area.');
            }
          });
        });
      }

      const map = mapInstanceRef.current;
      // Clear old markers
      markersRef.current.forEach(m => m.setMap(null));
      markersRef.current = [];

      // Add new markers sequentially
      locations.forEach((loc, index) => {
        const marker = new google.maps.Marker({
          position: loc,
          map,
          label: { text: (index + 1).toString(), color: 'white', fontWeight: 'bold' },
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            fillColor: '#4f46e5', // Indigo to match theme
            fillOpacity: 1,
            strokeWeight: 2,
            strokeColor: '#ffffff',
            scale: 12
          }
        });
        markersRef.current.push(marker);
      });

    }).catch(e => console.error(e));

    return () => { isMounted = false; };
  }, [locations, setLocations, maxRounds]);

  const handleSearchLocation = async () => {
    if (!searchQuery.trim() || locations.length >= maxRounds) return;
    setIsSearching(true);
    setMapError('');
    try {
      const google = await loadGoogleMaps();
      const svService = new google.maps.StreetViewService();
      const geocoder = new google.maps.Geocoder();

      // Check if user pasted raw GPS coords (lat, lng)
      const parts = searchQuery.split(',');
      let targetLatLng = null;
      if (parts.length === 2 && !isNaN(parseFloat(parts[0])) && !isNaN(parseFloat(parts[1]))) {
         targetLatLng = { lat: parseFloat(parts[0]), lng: parseFloat(parts[1]) };
      } else {
         // Use Google Geocoding API
         const res = await geocoder.geocode({ address: searchQuery });
         if (res.results && res.results.length > 0) {
            targetLatLng = { lat: res.results[0].geometry.location.lat(), lng: res.results[0].geometry.location.lng() };
            if (mapInstanceRef.current) {
               mapInstanceRef.current.setCenter(targetLatLng);
               mapInstanceRef.current.setZoom(10);
            }
         }
      }

      if (targetLatLng) {
         // Ensure the location has actual Street View coverage
         svService.getPanorama({ location: targetLatLng, radius: 50000, source: google.maps.StreetViewSource.OUTDOOR }, (data, status) => {
            if (status === 'OK' && data.location && data.location.latLng) {
               setLocations(prev => {
                 if (prev.length >= maxRounds) return prev;
                 return [...prev, { lat: data.location.latLng.lat(), lng: data.location.latLng.lng() }];
               });
               setSearchQuery('');
            } else {
               setMapError("No Street View data near this location.");
            }
         });
      } else {
         setMapError("Location not found.");
      }
    } catch (e) {
      setMapError("Search failed.");
    }
    setIsSearching(false);
  };

  return (
    <div className="w-full relative group flex flex-col gap-3">
      <div className="w-full h-48 md:h-64 rounded-xl overflow-hidden relative shadow-inner border border-white/10 group">
        <div ref={mapContainerRef} className="absolute inset-0 bg-[#e3f0f7]" />
        {locations.length >= maxRounds && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-red-500 text-white text-[10px] font-bold px-3 py-1 rounded-full z-10 shadow-lg animate-in slide-in-from-top-2">
            MAX {maxRounds} PINS PLACED
          </div>
        )}
        {locations.length > 0 && (
           <button onClick={() => setLocations([])} className="absolute bottom-3 right-3 bg-slate-900/90 hover:bg-red-500 text-white text-[10px] font-bold uppercase tracking-widest px-4 py-2 rounded-lg z-10 transition-colors shadow-lg border border-white/10">
             Clear All
           </button>
        )}
        {locations.length === 0 && (
           <div className="absolute inset-0 pointer-events-none flex items-center justify-center bg-black/40 group-hover:bg-transparent transition-colors">
              <span className="bg-black/60 backdrop-blur-md text-white text-xs font-bold uppercase tracking-widest px-4 py-2 rounded-full border border-white/10 group-hover:opacity-0 transition-opacity text-center mx-4">
                 Click map or search to drop pins
              </span>
           </div>
        )}
      </div>

      {/* Advanced Text/Geocode Search Box */}
      <div className="flex gap-2">
         <div className="relative flex-1">
           <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
           <input type="text" placeholder="Search city, country or paste GPS (lat, lng)..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearchLocation()}
             className="w-full bg-black/40 border border-white/10 rounded-xl pl-10 pr-4 py-3 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-white font-medium text-xs md:text-sm transition-all placeholder:text-slate-500 shadow-inner"
           />
         </div>
         <button onClick={handleSearchLocation} disabled={isSearching || locations.length >= maxRounds}
           className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 text-white px-4 md:px-6 rounded-xl font-bold shadow-lg transition-all active:scale-95 text-xs md:text-sm flex items-center gap-2">
           {isSearching ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : "Add Pin"}
         </button>
      </div>
      {mapError && <p className="text-red-400 text-[10px] md:text-xs font-bold px-1">{mapError}</p>}
    </div>
  );
};

// --- INTERACTIVE LOBBY AVATARS ---
const BouncingAvatars = ({ players }) => {
  const containerRef = useRef(null);
  const avatarsRef = useRef({});
  const physicsRef = useRef({});
  const mouseRef = useRef({ x: -1000, y: -1000, active: false });

  // Dynamic sizing based on player count to support 70+ players
  const isCrowded = players.length > 30;
  const currentRadius = isCrowded ? 16 : 24; // 32px vs 48px diameter
  const avatarSizeClass = isCrowded ? 'w-8 h-8' : 'w-12 h-12';

  useEffect(() => {
     // Initialize new players safely
     players.forEach(p => {
       if (!physicsRef.current[p.id]) {
          physicsRef.current[p.id] = {
             x: Math.random() * 300 + 20, // Spread them out more initially
             y: Math.random() * 200 + 20,
             vx: (Math.random() - 0.5) * 6,
             vy: (Math.random() - 0.5) * 6,
             radius: currentRadius
          };
       }
     });
     
     // Cleanup removed players & Update Radius dynamically
     const currentIds = new Set(players.map(p => p.id));
     Object.keys(physicsRef.current).forEach(id => {
        if (!currentIds.has(id)) {
           delete physicsRef.current[id];
           delete avatarsRef.current[id];
        } else {
           physicsRef.current[id].radius = currentRadius;
        }
     });
  }, [players, currentRadius]);

  useEffect(() => {
    let animationFrameId;
    const update = () => {
       const container = containerRef.current;
       if (!container) return;
       const rect = container.getBoundingClientRect();
       const width = rect.width;
       const height = rect.height;

       const physics = physicsRef.current;
       const keys = Object.keys(physics);

       keys.forEach(key => {
          const p = physics[key];

          // Mouse repel force
          if (mouseRef.current.active) {
             const dx = p.x + p.radius - mouseRef.current.x;
             const dy = p.y + p.radius - mouseRef.current.y;
             const dist = Math.sqrt(dx*dx + dy*dy);
             if (dist < 150) { // Increased repel radius for larger area
                const force = (150 - dist) / 150;
                p.vx += (dx / dist) * force * 2.5;
                p.vy += (dy / dist) * force * 2.5;
             }
          }

          // Apply velocity
          p.x += p.vx;
          p.y += p.vy;

          // Friction (slight damping)
          p.vx *= 0.99;
          p.vy *= 0.99;
          
          // Base speed minimum to keep them moving
          const speed = Math.sqrt(p.vx*p.vx + p.vy*p.vy);
          if (speed < 1.2) {
             p.vx *= 1.05;
             p.vy *= 1.05;
          }

          // Boundary Collision
          if (p.x <= 0) { p.x = 0; p.vx *= -1; }
          if (p.x >= width - p.radius * 2) { p.x = width - p.radius * 2; p.vx *= -1; }
          if (p.y <= 0) { p.y = 0; p.vy *= -1; }
          if (p.y >= height - p.radius * 2) { p.y = height - p.radius * 2; p.vy *= -1; }
       });

       // Circle Collision (Avatars bouncing off each other)
       for (let i = 0; i < keys.length; i++) {
          for (let j = i + 1; j < keys.length; j++) {
             const p1 = physics[keys[i]];
             const p2 = physics[keys[j]];
             const dx = (p1.x + p1.radius) - (p2.x + p2.radius);
             const dy = (p1.y + p1.radius) - (p2.y + p2.radius);
             const dist = Math.sqrt(dx*dx + dy*dy);
             const minDist = p1.radius + p2.radius;
             
             if (dist < minDist && dist > 0) {
                const angle = Math.atan2(dy, dx);
                const overlap = minDist - dist;
                
                // Push apart
                p1.x += Math.cos(angle) * overlap * 0.5;
                p1.y += Math.sin(angle) * overlap * 0.5;
                p2.x -= Math.cos(angle) * overlap * 0.5;
                p2.y -= Math.sin(angle) * overlap * 0.5;
                
                // Elastic Bounce
                const nx = dx / dist;
                const ny = dy / dist;
                const p1n = p1.vx * nx + p1.vy * ny;
                const p2n = p2.vx * nx + p2.vy * ny;
                const dp = p1n - p2n;
                
                p1.vx -= dp * nx;
                p1.vy -= dp * ny;
                p2.vx += dp * nx;
                p2.vy += dp * ny;
             }
          }
       }

       // DOM Update
       keys.forEach(key => {
          const el = avatarsRef.current[key];
          if (el) el.style.transform = `translate(${physics[key].x}px, ${physics[key].y}px)`;
       });

       animationFrameId = requestAnimationFrame(update);
    };
    update();
    return () => cancelAnimationFrame(animationFrameId);
  }, [players]);

  const handleMouseMove = (e) => {
     const rect = containerRef.current.getBoundingClientRect();
     mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top, active: true };
  };
  
  const handleMouseLeave = () => { mouseRef.current.active = false; };

  const handleTouchMove = (e) => {
     if (!e.touches[0]) return;
     const rect = containerRef.current.getBoundingClientRect();
     mouseRef.current = { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top, active: true };
  };

  return (
     <div 
        ref={containerRef} 
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleMouseLeave}
        className="w-full flex-1 min-h-[350px] md:min-h-[450px] border border-blue-500/20 rounded-3xl bg-slate-950 shadow-[inset_0_0_50px_rgba(0,0,0,0.8)] relative overflow-hidden group cursor-crosshair"
     >
        {/* Tactical Satellite Picture Background */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden opacity-50 mix-blend-screen">
           <img 
              src="https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=2072&auto=format&fit=crop" 
              alt="Tactical Earth View" 
              className="w-full h-full object-cover grayscale brightness-50 contrast-125" 
           />
           {/* Dark fade gradients to blend the edges smoothly */}
           <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-slate-950 opacity-80"></div>
           <div className="absolute inset-0 bg-gradient-to-r from-slate-950 via-transparent to-slate-950 opacity-80"></div>
        </div>

        {/* Subtle Tech Grid Overlay */}
        <div className="absolute inset-0 pointer-events-none opacity-20 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] mix-blend-overlay"></div>
        
        {players.map(p => (
           <div
              key={p.id}
              ref={el => avatarsRef.current[p.id] = el}
              className={`absolute top-0 left-0 ${avatarSizeClass} rounded-full border-2 bg-slate-900 shadow-[0_0_20px_rgba(0,0,0,0.8)] flex items-center justify-center group/avatar hover:z-50 will-change-transform`}
              style={{ borderColor: p.color }}
           >
              <img src={p.avatar} alt={p.name} className="w-full h-full rounded-full pointer-events-none" />
              <div className={`absolute ${isCrowded ? '-bottom-5 text-[8px]' : '-bottom-6 text-[10px]'} bg-black/90 text-white font-bold px-2 py-0.5 rounded opacity-0 group-hover/avatar:opacity-100 transition-opacity whitespace-nowrap pointer-events-none border border-white/10 z-50`}>
                 {p.name}
              </div>
           </div>
        ))}
        {players.length === 0 && <div className="absolute inset-0 flex items-center justify-center text-blue-500/80 font-black text-sm md:text-xl tracking-[0.3em] uppercase pointer-events-none drop-shadow-lg">Scanning for Operatives...</div>}
        {players.length > 0 && <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-blue-300/60 text-[10px] uppercase tracking-[0.2em] pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity font-bold bg-black/40 px-3 py-1 rounded-full backdrop-blur-sm border border-white/5">Hover/Drag to repel</div>}
     </div>
  );
};


// --- MAIN APP COMPONENT ---
export default function App() {
  const [user, setUser] = useState(null);
  const [view, setView] = useState('menu'); 
  const [playerName, setPlayerName] = useState('');
  const [roomName, setRoomName] = useState(''); 
  const [joinCode, setJoinCode] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [roomData, setRoomData] = useState(null);
  const [isSinglePlayer, setIsSinglePlayer] = useState(false);
  const [hostWillPlay, setHostWillPlay] = useState(true);
  const [showLivePlayers, setShowLivePlayers] = useState(true);
  const [devMode, setDevMode] = useState(false); 
  const [hideUI, setHideUI] = useState(false); 

  const [errorMsg, setErrorMsg] = useState('');
  const [isGeneratingLocations, setIsGeneratingLocations] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  
  // Game Settings
  const [numRounds, setNumRounds] = useState(5);
  const [timeLimit, setTimeLimit] = useState(60); 
  const [region, setRegion] = useState('world');
  const [customLocations, setCustomLocations] = useState([]); // Array of {lat, lng}
  
  const [activeGuess, setActiveGuess] = useState(null);
  const [isMapExpanded, setIsMapExpanded] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);
  
  const [matchHistory, setMatchHistory] = useState([]);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [selectedHistoryRound, setSelectedHistoryRound] = useState(null);

  const timerIntervalRef = useRef(null);
  const activeGuessRef = useRef(null);
  const roomDataRef = useRef(roomData);

  useEffect(() => { activeGuessRef.current = activeGuess; }, [activeGuess]);
  useEffect(() => { roomDataRef.current = roomData; }, [roomData]);

  // Handle Round Reduction (trim custom pins if user lowers round count)
  useEffect(() => {
     if (customLocations.length > numRounds) {
        setCustomLocations(prev => prev.slice(0, numRounds));
     }
  }, [numRounds, customLocations]);

  // Handle Invitation Links
  useEffect(() => {
    const hash = window.location.hash.replace('#', '').substring(0, 4).toUpperCase();
    if (hash.length === 4) {
      setJoinCode(hash);
      setInviteCode(hash);
    }
  }, []);

  useEffect(() => {
    const initAuth = async () => {
      try { 
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth); 
        }
      } catch (err) { setErrorMsg("Database Connection Error."); }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    loadGoogleMaps().catch(e => console.error("Prefetch Map Failed:", e));
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user || !roomCode || isSinglePlayer) return;
    
    const roomRef = getRoomRef(roomCode);
    const unsubscribe = onSnapshot(roomRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        setRoomData(data);
        if (['lobby', 'playing', 'round_result', 'game_over'].includes(data.status)) setView(data.status);
        if (data.status === 'playing' && data.hostId === user.uid) {
          const currentGuesses = data.guesses?.[data.currentRound] || {}; // SAFE GUARD
          // Only wait for players that are actively in the game (not spectators)
          const numActivePlayers = Object.keys(data.players || {}).length; // SAFE GUARD
          if (numActivePlayers > 0 && Object.keys(currentGuesses).length === numActivePlayers) {
             const updatedPlayers = { ...(data.players || {}) };
             Object.entries(currentGuesses).forEach(([uid, guess]) => updatedPlayers[uid].score += guess.score);
             updateDoc(roomRef, { status: 'round_result', players: updatedPlayers });
          }
        }
      } else { setView('menu'); }
    }, (err) => {
      console.error("Firestore Error:", err);
      setErrorMsg("Sync Lost. Check Connection.");
    });
    return () => unsubscribe();
  }, [user, roomCode, isSinglePlayer]);


  const getShareLink = () => `${window.location.origin}/#${roomCode}`;

  const copyLink = () => {
    const url = getShareLink();
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => {
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 2000);
      });
    }
  };

  const createRoom = async () => {
    if (!user || isJoining || isGeneratingLocations) return;
    setIsJoining(true);
    setIsSinglePlayer(false);
    setErrorMsg('');
    const code = generateRoomCode();
    const roomRef = getRoomRef(code);
    
    const finalName = playerName.trim() || 'Host';
    const initialPlayers = hostWillPlay 
      ? { [user.uid]: { name: finalName.substring(0, 15), avatar: getAvatarUrl(user.uid), score: 0, color: getPlayerColor(0, 1) } }
      : {};

    try {
      await setDoc(roomRef, {
        status: 'lobby', hostId: user.uid, 
        roomName: roomName.trim() || `${finalName}'s Room`,
        settings: { numRounds, timeLimit, region, customLocations },
        players: initialPlayers,
        locations: [], currentRound: 0, guesses: {}
      });
      setRoomCode(code);
      setView('lobby');
      setMatchHistory([]);
    } catch (err) { 
      setErrorMsg("Host Error: Check Permissions."); 
    } finally { setIsJoining(false); }
  };

  const joinRoom = async () => {
    const codeToJoin = inviteCode || joinCode;
    if (!user || codeToJoin.length !== 4 || isJoining) return;
    setIsJoining(true);
    setErrorMsg('');
    try {
      const roomRef = getRoomRef(codeToJoin);
      const snap = await getDoc(roomRef);
      if (!snap.exists()) {
        setErrorMsg('Room not found. The host may have ended it.');
      } else {
        const data = snap.data();
        const finalName = playerName.trim() || 'Operative';
        await updateDoc(roomRef, { [`players.${user.uid}`]: { name: finalName.substring(0, 15), avatar: getAvatarUrl(user.uid), score: 0, color: getPlayerColor(Object.keys(data.players || {}).length, 8) } });
        setRoomCode(codeToJoin);
        setInviteCode(''); 
        setView('lobby');
      }
    } catch (e) { setErrorMsg('Join Error.'); }
    setIsJoining(false);
  };

  const startSinglePlayer = async () => {
     if (isGeneratingLocations) return;
     setIsGeneratingLocations(true);
     setIsSinglePlayer(true);
     setMatchHistory([]);
     setSelectedHistoryRound(null);
     try {
      const google = await loadGoogleMaps();
      const svService = new google.maps.StreetViewService();

      const locations = await Promise.all(Array.from({ length: numRounds }).map((_, i) => {
          const customCoord = customLocations.length > 0 ? customLocations[i % customLocations.length] : null;
          return getRandomStreetViewLocation(svService, region, google, customCoord);
      }));

      const uid = user ? user.uid : 'solo';
      const finalName = playerName.trim() || 'Guest';
      setRoomData({
         status: 'playing', hostId: uid, 
         settings: { numRounds, timeLimit, region },
         players: { [uid]: { name: finalName, avatar: getAvatarUrl(uid), score: 0, color: '#3b82f6' } },
         locations, currentRound: 0, guesses: {}
      });
      setView('playing');
      setIsMapExpanded(false);
      setActiveGuess(null);
      setHideUI(false);
     } catch (err) { setErrorMsg("Location Generation Failed."); } finally { setIsGeneratingLocations(false); }
  };

  const startMatch = async () => {
    if (!roomData || roomData.hostId !== user.uid || isGeneratingLocations) return;
    setIsGeneratingLocations(true);
    try {
      const google = await loadGoogleMaps();
      const svService = new google.maps.StreetViewService();
      
      const matchRegion = roomData.settings?.region || 'world';
      const matchNumRounds = roomData.settings?.numRounds || 5;
      const hostCustomLocs = roomData.settings?.customLocations || [];

      const locations = await Promise.all(Array.from({ length: matchNumRounds }).map((_, i) => {
          const customCoord = hostCustomLocs.length > 0 ? hostCustomLocs[i % hostCustomLocs.length] : null;
          return getRandomStreetViewLocation(svService, matchRegion, google, customCoord);
      }));

      const playersObj = { ...(roomData.players || {}) }; // SAFE GUARD
      Object.keys(playersObj).forEach((uid) => { playersObj[uid].score = 0; });
      await updateDoc(getRoomRef(roomCode), { status: 'playing', locations, currentRound: 0, players: playersObj, guesses: {} });
      setHideUI(false);
    } catch (err) { setErrorMsg("Match Start Failed."); } finally { setIsGeneratingLocations(false); }
  };

  const submitGuess = async (guessOverride = null, isTimeout = false) => {
    // Clock keeps ticking visually down below
    const finalGuess = guessOverride || activeGuess;
    if (!user || !roomData) return;
    if (!finalGuess && !isTimeout) return; 

    const actualLoc = roomData.locations?.[roomData.currentRound] || { lat: 0, lng: 0 }; // SAFE GUARD
    const distance = finalGuess ? calculateDistance(finalGuess.lat, finalGuess.lng, actualLoc.lat, actualLoc.lng) : null;
    const score = finalGuess ? calculateScore(distance) : 0;
    const uid = isSinglePlayer ? Object.keys(roomData.players || {})[0] : user?.uid;
    const guessData = finalGuess ? { ...finalGuess, distance, score } : { lat: null, lng: null, distance, score, timeout: true };

    setMatchHistory(prev => [...prev, {
      round: roomData.currentRound + 1, actual: actualLoc, guess: finalGuess, score, distance
    }]);

    if (isSinglePlayer) {
      setRoomData(prev => ({
          ...prev, status: 'round_result',
          guesses: { ...(prev.guesses || {}), [prev.currentRound]: { [uid]: guessData } },
          players: { ...(prev.players || {}), [uid]: { ...prev.players[uid], score: (prev.players[uid]?.score || 0) + score } }
      }));
      setView('round_result');
    } else {
      await updateDoc(getRoomRef(roomCode), { [`guesses.${roomData.currentRound}.${uid}`]: guessData });
    }
    setActiveGuess(null);
    setIsMapExpanded(false);
  };

  const nextRound = async () => {
    const isGameOver = roomData.currentRound + 1 >= (roomData.settings?.numRounds || 5);
    if (isSinglePlayer) {
      setRoomData(prev => ({ ...prev, status: isGameOver ? 'game_over' : 'playing', currentRound: prev.currentRound + 1 }));
      setView(isGameOver ? 'game_over' : 'playing');
    } else {
      await updateDoc(getRoomRef(roomCode), { status: isGameOver ? 'game_over' : 'playing', currentRound: roomData.currentRound + 1 });
    }
    setActiveGuess(null);
    setIsMapExpanded(false);
    setHideUI(false);
  };

  const returnToLobby = async () => {
    if (!roomData || roomData.hostId !== user.uid) return;
    const playersObj = { ...(roomData.players || {}) };
    Object.keys(playersObj).forEach((uid) => { playersObj[uid].score = 0; });
    await updateDoc(getRoomRef(roomCode), {
      status: 'lobby',
      players: playersObj,
      currentRound: 0,
      guesses: {},
      locations: []
    });
  };

  const handleExit = () => {
    setView('menu');
    setIsSinglePlayer(false);
    setRoomCode('');
    setRoomData(null);
    setActiveGuess(null);
    setIsMapExpanded(false);
    setHideUI(false);
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    window.location.hash = '';
    setInviteCode('');
  };

  useEffect(() => {
    // Start/reset timer when entering 'playing' state for a new round
    if (view === 'playing' && roomData && (roomData.settings?.timeLimit || 0) > 0) {
      setTimeLeft(roomData.settings.timeLimit);
      
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      
      timerIntervalRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            clearInterval(timerIntervalRef.current);
            
            // Use ref to get latest data without triggering re-renders
            const currentRoom = roomDataRef.current;
            const uid = isSinglePlayer ? Object.keys(currentRoom?.players || {})[0] : user?.uid;
            const hasGuessed = uid && !!currentRoom?.guesses?.[currentRoom.currentRound]?.[uid];
            const isSpectating = !isSinglePlayer && uid && !(currentRoom?.players || {})[uid];
            
            if (!hasGuessed && !isSpectating && uid) {
              submitGuess(activeGuessRef.current, true);
            }
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      
      return () => { if (timerIntervalRef.current) clearInterval(timerIntervalRef.current); };
    }
  }, [view, roomData?.currentRound]); // Only run when round changes or view changes

  // Host Fail-safe Timer (Forces the transition when time runs out)
  useEffect(() => {
    const isHost = roomData?.hostId === user?.uid;
    if (view === 'playing' && roomData && isHost && !isSinglePlayer && (roomData.settings?.timeLimit || 0) > 0) {
      const fallbackTimer = setTimeout(() => {
        if (roomDataRef.current?.status === 'playing') {
          updateDoc(getRoomRef(roomCode), { status: 'round_result' });
        }
      }, (roomData.settings.timeLimit + 3) * 1000); // 3 seconds grace period for late network syncs
      return () => clearTimeout(fallbackTimer);
    }
  }, [view, roomData?.currentRound, user?.uid, isSinglePlayer, roomCode]);

  // --- MOCKUP DEVELOPMENT TOOLS ---
  const addTestBots = async () => {
    if (!roomData || roomData.hostId !== user?.uid) return;
    const newPlayers = { ...(roomData.players || {}) };
    for (let i = 1; i <= 40; i++) {
      const botId = `bot_${Math.random().toString(36).substring(2, 9)}`;
      newPlayers[botId] = {
        name: `Operative ${i}`,
        avatar: getAvatarUrl(botId),
        score: 0,
        color: getPlayerColor(i, 40)
      };
    }
    await updateDoc(getRoomRef(roomCode), { players: newPlayers });
  };

  const simulateBotGuesses = async () => {
    if (!roomData || roomData.hostId !== user?.uid) return;
    const currentLoc = roomData.locations?.[roomData.currentRound];
    if (!currentLoc) return; // SAFE GUARD
    const currentGuesses = roomData.guesses?.[roomData.currentRound] || {}; // SAFE GUARD
    const updates = {};
    
    let botsAdded = false;
    Object.keys(roomData.players || {}).forEach(pid => {
      if (pid.startsWith('bot_') && !currentGuesses[pid]) {
        // Create random coordinates centered around the actual location
        const lat = currentLoc.lat + (Math.random() - 0.5) * 60; 
        const lng = currentLoc.lng + (Math.random() - 0.5) * 60;
        const distance = calculateDistance(lat, lng, currentLoc.lat, currentLoc.lng);
        const score = calculateScore(distance);
        updates[`guesses.${roomData.currentRound}.${pid}`] = { lat, lng, distance, score };
        botsAdded = true;
      }
    });
    
    if (botsAdded) {
      await updateDoc(getRoomRef(roomCode), updates);
    }
  };


  // --- 1. REVAMPED MENU VIEW ---
  if (view === 'menu') {
    // 1A: Minimal Invite UI when a code is present in the URL
    if (inviteCode) {
      return (
        <div className="min-h-screen bg-[#050B14] text-slate-100 flex items-center justify-center p-4 font-sans relative overflow-hidden">
          {/* Animated Background Gradients */}
          <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-emerald-600/20 blur-[120px] rounded-full pointer-events-none"></div>
          <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-blue-600/20 blur-[120px] rounded-full pointer-events-none"></div>
          
          <div className="relative z-10 w-full max-w-md bg-slate-900/60 backdrop-blur-3xl border border-white/10 rounded-[2rem] shadow-[0_0_50px_rgba(0,0,0,0.5)] p-8 md:p-12 flex flex-col items-center text-center animate-in zoom-in-95 duration-300">
             <Globe size={64} className="text-emerald-400 mb-6 drop-shadow-[0_0_20px_rgba(52,211,153,0.6)] animate-pulse" />
             <h2 className="text-3xl md:text-4xl font-black mb-2 tracking-tight text-white">Join Operation</h2>
             <p className="text-slate-400 text-sm md:text-base mb-8">You've been invited to room <span className="text-white font-mono font-black bg-white/10 px-2 py-1 rounded ml-1 tracking-widest">{inviteCode}</span></p>

             <div className="w-full space-y-4">
               <div className="relative">
                 <User size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" />
                 <input type="text" placeholder="Enter your nickname..." value={playerName} onChange={(e) => setPlayerName(e.target.value)} maxLength={15}
                    className="w-full bg-black/40 border border-white/10 rounded-2xl pl-12 pr-5 py-4 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-white font-bold text-lg transition-all placeholder:text-slate-600 shadow-inner"
                  />
               </div>
               
               <button onClick={joinRoom} disabled={!user || isJoining} 
                  className="w-full bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 disabled:opacity-50 text-white p-4 rounded-2xl font-black tracking-widest text-lg shadow-[0_0_25px_rgba(16,185,129,0.4)] transition-all active:scale-95 flex justify-center items-center gap-2">
                  {isJoining ? <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : "JOIN GAME"}
               </button>
             </div>

             <button onClick={() => { setInviteCode(''); window.location.hash = ''; }} className="mt-8 text-slate-500 text-xs font-bold uppercase tracking-widest hover:text-white transition-colors">
               Or return to Main Menu
             </button>

             {!user && <p className="mt-4 text-emerald-400/80 font-bold animate-pulse text-[10px] uppercase tracking-widest">Connecting to Database...</p>}
             {errorMsg && <div className="mt-4 bg-red-500/20 border border-red-500/50 text-red-200 px-4 py-2 rounded-xl backdrop-blur-md font-bold text-sm">{errorMsg}</div>}
          </div>
        </div>
      );
    }

    // 1B: Standard Main Menu (FullScreen Dashboard)
    return (
      <div className="min-h-screen bg-[#050B14] text-slate-100 flex items-center justify-center p-4 md:p-8 font-sans relative overflow-x-hidden">
        {/* Hidden Developer Toggle */}
        <button onClick={() => setDevMode(!devMode)} className="fixed bottom-2 right-2 text-[10px] text-white/10 hover:text-white/50 z-50 tracking-widest uppercase font-bold transition-colors">
           Dev Mode: {devMode ? 'ON' : 'OFF'}
        </button>

        {/* Animated Background Gradients */}
        <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] bg-blue-600/10 blur-[120px] rounded-full pointer-events-none"></div>
        <div className="absolute bottom-[-20%] right-[-10%] w-[60%] h-[60%] bg-emerald-600/10 blur-[120px] rounded-full pointer-events-none"></div>

        <div className="relative z-10 w-full max-w-7xl mx-auto flex flex-col lg:flex-row gap-6 md:gap-8 max-h-[95vh]">
          
          {/* LEFT COLUMN: IDENTITY & JOIN */}
          <div className="w-full lg:w-1/3 flex flex-col gap-6 md:gap-8 shrink-0">
            
            {/* Brand Hero */}
            <div className="bg-slate-900/60 backdrop-blur-3xl border border-white/10 rounded-[2rem] p-8 md:p-10 shadow-2xl flex flex-col items-center text-center relative overflow-hidden shrink-0">
               <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-10 mix-blend-overlay pointer-events-none"></div>
               <Globe size={72} className="text-blue-400 mb-6 drop-shadow-[0_0_30px_rgba(96,165,250,0.6)] animate-[pulse_4s_ease-in-out_infinite]" />
               <h1 className="text-4xl md:text-5xl lg:text-6xl font-black tracking-tighter mb-3 bg-gradient-to-br from-white via-blue-100 to-blue-400 bg-clip-text text-transparent leading-none">
                 World<br/>Guessr
               </h1>
               <p className="text-blue-200/60 text-sm md:text-base font-medium tracking-wide">Explore. Pinpoint. Win.</p>
               {!user && <div className="mt-6 px-4 py-2 bg-blue-500/10 border border-blue-500/20 rounded-full flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-blue-400 animate-ping"></div><span className="text-[10px] text-blue-300 font-bold uppercase tracking-widest">Connecting...</span></div>}
            </div>

            {/* Profile & Fast Join (Adjusted h-fit to prevent over-stretching) */}
            <div className="bg-slate-900/60 backdrop-blur-3xl border border-white/10 rounded-[2rem] p-6 shadow-2xl flex flex-col gap-6 shrink-0 h-fit">
              
              <div className="group">
                <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest mb-2 ml-2 group-focus-within:text-blue-400 transition-colors flex items-center gap-2"><User size={12}/> Player Identity</p>
                <div className="relative">
                  <input type="text" placeholder="Enter Nickname..." value={playerName} onChange={(e) => setPlayerName(e.target.value)} maxLength={15}
                    className="w-full bg-black/40 border border-white/10 rounded-2xl px-5 py-4 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-white font-bold text-lg transition-all placeholder:text-slate-600 shadow-inner"
                  />
                </div>
              </div>

              <div className="border-t border-white/5 my-1"></div>

              <div>
                <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest mb-2 ml-2 flex items-center gap-2"><Navigation size={12}/> Join Operation</p>
                <div className="flex gap-2">
                  <input type="text" placeholder="CODE" value={joinCode} onChange={(e) => setJoinCode(e.target.value.substring(0,4).toUpperCase())} 
                    className="w-full bg-black/40 border border-white/10 rounded-2xl px-4 py-3.5 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-white font-mono font-black text-center text-xl tracking-[0.3em] uppercase shadow-inner placeholder:text-slate-600 placeholder:tracking-normal" />
                  <button onClick={joinRoom} disabled={!user || joinCode.length !== 4 || isJoining} 
                    className="w-24 md:w-28 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-600 text-white rounded-2xl font-bold shadow-[0_0_20px_rgba(5,150,105,0.3)] transition-all active:scale-95 text-sm md:text-base">
                    JOIN
                  </button>
                </div>
              </div>

            </div>
          </div>

          {/* RIGHT COLUMN: OPERATION DASHBOARD */}
          <div className="w-full lg:w-2/3 bg-slate-900/60 backdrop-blur-3xl border border-white/10 rounded-[2rem] p-6 md:p-8 lg:p-12 shadow-2xl flex flex-col relative overflow-y-auto custom-scrollbar">
            <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 blur-[80px] rounded-full pointer-events-none"></div>

            <div className="space-y-6 md:space-y-8 relative z-10 flex-1">
              <div className="border-b border-white/10 pb-6 shrink-0">
                <h2 className="text-2xl md:text-3xl font-black text-white tracking-tight mb-2 flex items-center gap-3"><Radar className="text-indigo-400 animate-[spin_4s_linear_infinite]" size={28}/> Operation Setup</h2>
                <p className="text-slate-400 text-sm md:text-base">Configure your drop parameters for Solo or Multiplayer deployment.</p>
              </div>

              {/* Room Name */}
              <div className="group shrink-0">
                <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest mb-2 ml-2 group-focus-within:text-indigo-400 transition-colors">Room Name</p>
                <input type="text" placeholder={`${playerName.trim() || 'My'} Room`} value={roomName} onChange={(e) => setRoomName(e.target.value)} maxLength={25}
                    className="w-full bg-black/40 border border-white/10 rounded-2xl px-5 py-4 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-white font-bold text-base transition-all placeholder:text-slate-600 shadow-inner"
                  />
              </div>

              {/* Rounds & Timer Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 shrink-0">
                 {/* Number of Rounds */}
                 <div>
                   <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest mb-2 ml-2">Number of Rounds</p>
                   <div className="flex justify-between items-center bg-black/40 border border-white/10 rounded-2xl p-1.5 gap-1.5 shadow-inner">
                     {[5, 10, 20, 30].map(r => (
                       <button key={r} onClick={() => setNumRounds(r)} className={`flex-1 py-3 rounded-xl font-black text-xs sm:text-sm transition-all ${numRounds === r ? 'bg-indigo-600 text-white shadow-[0_0_15px_rgba(79,70,229,0.4)] scale-105' : 'text-slate-500 hover:text-white hover:bg-white/5'}`}>
                         {r}
                       </button>
                     ))}
                   </div>
                 </div>

                 {/* Timer Settings */}
                 <div>
                   <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest mb-2 ml-2">Round Timer</p>
                   <div className="flex justify-between items-center bg-black/40 border border-white/10 rounded-2xl p-1.5 gap-1.5 shadow-inner">
                     {[15, 30, 60, 120, 0].map(t => (
                       <button key={t} onClick={() => setTimeLimit(t)} className={`flex-1 py-3 rounded-xl font-black text-xs sm:text-sm transition-all ${timeLimit === t ? 'bg-slate-700 text-white shadow-[0_0_15px_rgba(255,255,255,0.1)] scale-105' : 'text-slate-500 hover:text-white hover:bg-white/5'}`}>
                         {t === 0 ? '∞' : `${t}s`}
                       </button>
                     ))}
                   </div>
                 </div>
              </div>

              {/* Map/Region Settings */}
              <div className="shrink-0">
                <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest mb-2 ml-2">Select Map Area</p>
                <div className="flex flex-col sm:flex-row bg-black/40 border border-white/10 rounded-2xl p-1.5 gap-1.5 shadow-inner">
                  <button onClick={() => setRegion('world')} className={`flex-1 py-3.5 rounded-xl font-bold transition-all flex items-center justify-center gap-2 text-sm ${region === 'world' ? 'bg-blue-600 text-white shadow-[0_0_20px_rgba(37,99,235,0.4)] scale-[1.02]' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}>
                    <Globe size={18} /> World Drop
                  </button>
                  <button onClick={() => setRegion('philippines')} className={`flex-1 py-3.5 rounded-xl font-bold transition-all flex items-center justify-center gap-2 text-sm ${region === 'philippines' ? 'bg-emerald-600 text-white shadow-[0_0_20px_rgba(5,150,105,0.4)] scale-[1.02]' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}>
                    <MapPin size={18} /> Philippines
                  </button>
                  <button onClick={() => setRegion('custom')} className={`flex-1 py-3.5 rounded-xl font-bold transition-all flex items-center justify-center gap-2 text-sm ${region === 'custom' ? 'bg-indigo-600 text-white shadow-[0_0_20px_rgba(79,70,229,0.4)] scale-[1.02]' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}>
                    <Navigation size={18} /> Drop Pins
                  </button>
                </div>
                {region === 'custom' && (
                  <div className="mt-4 animate-in fade-in slide-in-from-top-2">
                    <div className="flex justify-between items-center mb-2 px-1">
                      <span className="text-slate-400 text-[10px] font-bold uppercase tracking-widest flex items-center gap-2"><MapPin size={12}/> Custom Map Points ({customLocations.length}/{numRounds})</span>
                      <span className="text-slate-500 text-[9px] font-bold uppercase tracking-widest">Leave empty for randoms</span>
                    </div>
                    <CustomMapSelector locations={customLocations} setLocations={setCustomLocations} maxRounds={numRounds} />
                  </div>
                )}
              </div>
              
              {/* Host & Advanced Settings */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-6 sm:gap-4 bg-black/40 border border-white/10 rounded-2xl p-4 md:p-6 shadow-inner shrink-0">
                 {/* Host Toggle */}
                 <div className="flex items-center justify-between w-full sm:w-1/2 gap-4">
                    <div className="flex flex-col">
                      <span className="text-slate-300 text-sm font-bold uppercase tracking-widest mb-1">Play as Host?</span>
                      <span className="text-[10px] text-slate-500 leading-tight">Disable to specate the room you create</span>
                    </div>
                    <button onClick={() => setHostWillPlay(!hostWillPlay)} className={`w-12 h-6 rounded-full transition-colors relative flex items-center shrink-0 ${hostWillPlay ? 'bg-emerald-500' : 'bg-slate-700'}`}>
                      <div className={`w-4 h-4 rounded-full bg-white transition-transform transform absolute ${hostWillPlay ? 'translate-x-7' : 'translate-x-1'}`} />
                    </button>
                 </div>

                 <div className="hidden sm:block w-px h-10 bg-white/10"></div> {/* Divider */}
                 <div className="block sm:hidden w-full h-px bg-white/10"></div> {/* Mobile Divider */}

                 {/* Dev Mode Toggle */}
                 <div className="flex items-center justify-between w-full sm:w-1/2 gap-4">
                    <div className="flex flex-col sm:pl-2">
                      <span className="text-slate-300 text-sm font-bold uppercase tracking-widest mb-1 text-left">Dev Mode</span>
                      <span className="text-[10px] text-slate-500 leading-tight text-left">Enable bot testing & simulations</span>
                    </div>
                    <button onClick={() => setDevMode(!devMode)} className={`w-12 h-6 rounded-full transition-colors relative flex items-center shrink-0 ${devMode ? 'bg-indigo-500' : 'bg-slate-700'}`}>
                      <div className={`w-4 h-4 rounded-full bg-white transition-transform transform absolute ${devMode ? 'translate-x-7' : 'translate-x-1'}`} />
                    </button>
                 </div>
              </div>

            </div>

            <div className="flex flex-col sm:flex-row gap-4 mt-8 relative z-10 pt-6 border-t border-white/10 shrink-0">
               <button onClick={startSinglePlayer} disabled={!user || isGeneratingLocations || isJoining} 
                  className="w-full sm:w-1/3 bg-white/5 hover:bg-white/10 border border-white/10 disabled:opacity-50 text-white py-4 rounded-2xl font-bold flex items-center gap-2 justify-center shadow-lg transition-all active:scale-95 text-sm md:text-base">
                  {isGeneratingLocations && isSinglePlayer ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : <><User size={20} /> Play Solo</>}
                </button>
                <button onClick={createRoom} disabled={!user || isJoining || isGeneratingLocations} 
                  className="w-full sm:w-2/3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-50 text-white py-4 rounded-2xl font-black flex justify-center items-center gap-3 shadow-[0_0_30px_rgba(79,70,229,0.4)] transition-all active:scale-95 text-base md:text-lg tracking-wide">
                  {isJoining && !isSinglePlayer ? <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : <><Users size={24} /> HOST MULTIPLAYER</>}
                </button>
            </div>
            {errorMsg && <div className="absolute top-4 right-4 bg-red-500/20 border border-red-500/50 text-red-200 px-4 py-2 rounded-xl backdrop-blur-md font-bold text-sm animate-in fade-in slide-in-from-top-4">{errorMsg}</div>}
          </div>
        </div>
      </div>
    );
  }

  // --- 2. REVAMPED LOBBY VIEW ---
  if (view === 'lobby' && !isSinglePlayer && roomData) {
    const isHost = roomData.hostId === user?.uid;
    const isSpectator = !(roomData.players || {})[user?.uid]; // SAFE GUARD
    const playersList = Object.values(roomData.players || {}); // SAFE GUARD
    const shareUrl = getShareLink();
    const hostPlayerName = (roomData.players || {})[roomData.hostId]?.name || 'Unknown';
    const displayRoomName = roomData.roomName || `${hostPlayerName}'s Room`;

    return (
      <div className="min-h-screen bg-[#050B14] text-slate-100 flex flex-col items-center justify-center p-4 md:p-8 font-sans relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-indigo-900/20 via-[#050B14] to-[#050B14] pointer-events-none"></div>
        
        {/* Expanded max-width from 4xl to 6xl to provide massive horizontal arena */}
        <div className="w-full max-w-6xl bg-slate-900/40 backdrop-blur-2xl p-6 md:p-10 rounded-[2rem] shadow-2xl border border-white/10 relative z-10 flex flex-col md:flex-row gap-6 md:gap-10">
          
          {/* Quick Exit / Leave Lobby Button */}
          <button onClick={handleExit} className="absolute top-4 left-4 md:top-6 md:left-6 bg-white/5 hover:bg-red-500/20 text-slate-400 hover:text-red-400 border border-white/10 hover:border-red-500/50 p-2 md:p-2.5 rounded-full transition-all z-50 shadow-lg group flex items-center gap-2" title="Return to Main Menu">
             <span className="hidden group-hover:block text-[10px] md:text-xs font-black uppercase tracking-widest px-2">Leave Room</span>
             <Home size={18} className="md:w-5 md:h-5" />
          </button>

          {/* Code Section (Locked to 1/3 width to give playground more room) */}
          <div className="w-full md:w-1/3 flex flex-col items-center justify-center border-b md:border-b-0 md:border-r border-white/10 pb-8 md:pb-0 md:pr-10 text-center shrink-0 pt-8 md:pt-0">
            <div className={`bg-blue-500/10 ${isSpectator ? 'text-blue-300' : 'text-blue-400'} border border-blue-500/20 px-4 py-1.5 rounded-full text-[10px] md:text-xs font-black uppercase tracking-widest mb-4 md:mb-6 inline-flex items-center gap-2`}>
              <Sparkles size={14}/> {isSpectator ? 'Spectating Room' : 'Waiting Area'}
            </div>
            
            <p className="text-slate-500 font-bold tracking-[0.2em] uppercase mb-1 text-xs truncate max-w-[250px]">{displayRoomName}</p>
            
            <h2 className="text-5xl sm:text-6xl md:text-7xl font-black font-mono tracking-widest text-white drop-shadow-[0_0_40px_rgba(255,255,255,0.3)] mb-6 md:mb-8 select-all">{roomCode}</h2>
            <div className="w-full flex bg-black/50 p-1.5 rounded-2xl border border-white/10 shadow-inner overflow-hidden">
               <input type="text" readOnly value={shareUrl} className="flex-1 bg-transparent text-slate-400 px-3 font-mono text-[10px] md:text-xs outline-none w-0" />
               <button onClick={copyLink} className={`px-4 md:px-5 py-2 md:py-3 rounded-xl font-bold flex items-center gap-2 transition-all text-xs md:text-sm shrink-0 ${copySuccess ? 'bg-emerald-500 text-white' : 'bg-white/10 hover:bg-white/20 text-white'}`}>
                 {copySuccess ? <CheckCircle size={16} /> : <Copy size={16} />} {copySuccess ? 'Copied' : 'Copy'}
               </button>
            </div>

            <div className="mt-8 w-full">
               {isHost ? (
                 <div className="flex flex-col gap-3">
                   <button onClick={startMatch} disabled={isGeneratingLocations || playersList.length === 0} className="w-full bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 disabled:opacity-50 p-4 md:p-5 rounded-2xl font-black text-lg md:text-xl shadow-[0_0_30px_rgba(16,185,129,0.3)] flex justify-center items-center gap-3 transition-transform active:scale-95 text-white">
                     {isGeneratingLocations ? <div className="w-5 h-5 md:w-6 md:h-6 border-4 border-white border-t-transparent rounded-full animate-spin" /> : <>START MATCH <ArrowRight size={20} /></>}
                   </button>
                   {/* Conditionally Rendered Dev Button */}
                   {devMode && (
                     <button onClick={addTestBots} className="text-[10px] text-slate-500 hover:text-white uppercase tracking-widest transition-colors font-bold border border-slate-800 rounded-full py-1.5 px-4 w-max mx-auto hover:bg-slate-800">
                       [DEV] Add 40 Test Bots
                     </button>
                   )}
                 </div>
               ) : <div className="w-full bg-white/5 border border-white/10 p-4 md:p-5 rounded-2xl text-center text-slate-400 font-bold flex justify-center items-center gap-3 text-sm md:text-base"><div className="w-3 h-3 md:w-4 md:h-4 rounded-full bg-blue-500 animate-pulse"></div> Waiting for host...</div>}
            </div>
          </div>

          {/* Players Section (2/3 width for massive playground) */}
          <div className="w-full md:w-2/3 flex flex-col min-h-0">
            <h3 className="text-lg md:text-xl font-black mb-4 md:mb-6 flex items-center justify-between border-b border-white/10 pb-4 shrink-0">
               <span className="flex items-center gap-3"><Users className="text-blue-400" /> Players Joined</span>
               <span className="bg-blue-600 px-3 py-1 rounded-full text-xs md:text-sm">{playersList.length} / 100</span>
            </h3>
            
            {/* Interactive Physics Bouncing Avatar Container */}
            <div className="flex-1 flex flex-col mb-2 min-h-0">
               <BouncingAvatars players={Object.entries(roomData.players || {}).map(([id, p]) => ({ id, ...p }))} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // --- 3. REVAMPED PLAYING VIEW ---
  if (view === 'playing' && roomData) {
    const currentLoc = roomData.locations?.[roomData.currentRound]; // SAFE GUARD
    const uid = isSinglePlayer ? Object.keys(roomData.players || {})[0] : user?.uid; // SAFE GUARD
    const isSpectating = !isSinglePlayer && uid && !(roomData.players || {})[uid]; // SAFE GUARD
    const hasGuessed = !isSpectating && uid && !!roomData.guesses?.[roomData.currentRound]?.[uid]; // SAFE GUARD
    const isHost = isSinglePlayer || roomData.hostId === user?.uid;

    // Leaderboard calcs
    const sortedPlayers = Object.entries(roomData.players || {})
      .map(([id, p]) => ({ id, ...p }))
      .sort((a, b) => (b.score || 0) - (a.score || 0));
    const top3 = sortedPlayers.slice(0, 3);
    const myRankIndex = sortedPlayers.findIndex(p => p.id === uid);
    const myRank = myRankIndex !== -1 ? myRankIndex + 1 : '-';
    const amIInTop3 = myRankIndex < 3;

    return (
      <div className="fixed inset-0 bg-black text-white font-sans flex flex-col overflow-hidden">
        <div className="absolute inset-0 z-0 bg-[#050B14]">
          <StreetView location={currentLoc} />
          <div className="absolute inset-0 shadow-[inset_0_0_100px_rgba(0,0,0,0.8)] pointer-events-none z-10"></div>
        </div>

        {/* Hide UI Toggle Button (Bottom Left) */}
        {!hasGuessed && (
          <button onClick={() => setHideUI(!hideUI)} className="absolute bottom-4 left-4 md:bottom-6 md:left-6 z-50 bg-black/60 backdrop-blur-md p-3 rounded-full text-slate-300 hover:text-white border border-white/10 hover:bg-black/80 transition-all shadow-lg">
            {hideUI ? <EyeOff size={20} className="md:w-6 md:h-6" /> : <Eye size={20} className="md:w-6 md:h-6" />}
          </button>
        )}

        {/* Floating Timer Pill - Made Smaller & Controlled by hideUI */}
        {(roomData.settings?.timeLimit || 0) > 0 && (
           <div className={`absolute top-4 md:top-6 left-1/2 transform -translate-x-1/2 z-30 pointer-events-none transition-opacity duration-300 ${hideUI ? 'opacity-0' : 'opacity-100'}`}>
              <div className={`backdrop-blur-xl px-3 py-1.5 md:px-4 md:py-2 rounded-full border shadow-[0_10px_30px_rgba(0,0,0,0.5)] flex items-center gap-2 transition-colors duration-300 ${timeLeft <= 10 ? 'bg-red-500/20 border-red-500/60 shadow-[0_0_30px_rgba(239,68,68,0.4)]' : 'bg-black/50 border-white/10'}`}>
                 <Clock size={14} className={`md:w-4 md:h-4 ${timeLeft <= 10 ? 'text-red-400 animate-pulse' : 'text-slate-300'}`} />
                 <span className={`text-lg md:text-xl font-black font-mono tracking-tight ${timeLeft <= 10 ? 'text-red-400' : 'text-white'}`}>00:{timeLeft.toString().padStart(2, '0')}</span>
              </div>
           </div>
        )}

        {/* --- Top Target Locked Banner - Pushed slightly down and smaller --- */}
        {hasGuessed && (
          <div className="absolute top-16 md:top-20 left-1/2 transform -translate-x-1/2 z-30 pointer-events-none animate-in slide-in-from-top-8 duration-500">
             <div className="bg-emerald-900/90 backdrop-blur-2xl border border-emerald-400/50 px-4 py-1.5 md:px-6 md:py-2 rounded-full shadow-[0_0_40px_rgba(16,185,129,0.4)] flex items-center gap-2">
                <CheckCircle size={16} className="md:w-5 md:h-5 text-emerald-400" />
                <div className="flex flex-col">
                  <span className="text-xs md:text-sm font-black text-white uppercase tracking-widest leading-none mb-0.5">Target Locked</span>
                  <span className="text-emerald-200/80 text-[7px] md:text-[9px] font-bold uppercase tracking-widest leading-none">Awaiting others...</span>
                </div>
             </div>
          </div>
        )}

        {/* Top Left HUD - Made Smaller & Controlled by hideUI */}
        <div className={`absolute top-4 md:top-6 left-4 md:left-6 z-20 pointer-events-none flex flex-col items-start gap-2 transition-opacity duration-300 ${hideUI ? 'opacity-0' : 'opacity-100'}`}>
           <div className="flex items-center gap-2 md:gap-3 pointer-events-auto">
             {/* Quick Exit / Abort Match Button */}
             <button onClick={handleExit} className="bg-black/60 backdrop-blur-xl border border-white/10 hover:border-red-500/50 hover:bg-red-500/20 text-slate-300 hover:text-red-400 p-2 md:p-3 rounded-xl md:rounded-2xl transition-all shadow-2xl flex items-center justify-center" title="Quit Operation">
               <Home size={16} className="md:w-5 md:h-5" />
             </button>
             
             {/* Round Info Pill */}
             <div className="bg-black/60 backdrop-blur-xl border border-white/10 px-2 py-1.5 md:px-3 md:py-2 rounded-xl md:rounded-2xl flex items-center gap-2 md:gap-3 shadow-2xl">
               <div className="bg-white/10 p-1.5 md:p-2 rounded-lg md:rounded-xl">
                 {roomData.settings?.region === 'philippines' ? <MapPin size={14} className="text-blue-400 md:w-4 md:h-4" /> : <Globe size={14} className="text-blue-400 md:w-4 md:h-4" />}
               </div>
               <div className="flex flex-col pr-1 md:pr-2">
                 <span className="text-[7px] md:text-[9px] font-bold text-blue-300 uppercase tracking-widest">{isSpectating ? 'Spectating' : (isSinglePlayer ? 'Solo Mode' : 'Match')}</span>
                 <span className="text-xs md:text-sm font-black text-white">Round {roomData.currentRound + 1} <span className="text-white/30">/</span> {roomData.settings?.numRounds || 5}</span>
               </div>
             </div>
          </div>

          {/* Dev Mode Bot Simulation Button */}
          {devMode && isHost && Object.keys(roomData.players || {}).some(p => p.startsWith('bot_')) && (
            <button onClick={simulateBotGuesses} className="bg-red-500/20 hover:bg-red-500/40 border border-red-500/50 text-red-300 text-[8px] md:text-[9px] uppercase font-bold tracking-widest px-2 py-1 rounded-full backdrop-blur-md transition-colors pointer-events-auto shadow-lg w-max">
              [DEV] Simulate Bot Guesses
            </button>
          )}
        </div>

        {/* Top Right HUD (Seamless Combined Panel) - Made Slimmer & Controlled by hideUI */}
        <div className={`absolute top-4 md:top-6 right-4 md:right-6 z-20 flex flex-col items-end pointer-events-auto shadow-2xl w-44 md:w-56 transition-opacity duration-300 ${hideUI ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
           {isSinglePlayer ? (
             <div className="bg-black/60 backdrop-blur-xl border border-white/10 px-3 md:px-4 py-1.5 md:py-2 rounded-xl md:rounded-2xl flex flex-col items-end">
               <span className="text-[7px] md:text-[9px] font-bold text-emerald-400 uppercase tracking-widest">Total Score</span>
               <span className="text-sm md:text-base font-black text-white font-mono tracking-tight">{(roomData.players?.[uid]?.score || 0).toLocaleString()}</span>
             </div>
           ) : (
             <>
                <div 
                  onClick={() => setShowLivePlayers(!showLivePlayers)}
                  className="w-full bg-black/60 backdrop-blur-xl border border-white/10 px-3 py-1.5 md:px-4 md:py-2 flex justify-between items-center cursor-pointer hover:bg-black/50 transition-colors"
                  style={{ borderTopLeftRadius: '1rem', borderTopRightRadius: '1rem', borderBottomLeftRadius: showLivePlayers ? 0 : '1rem', borderBottomRightRadius: showLivePlayers ? 0 : '1rem' }}
                >
                  <div className="flex flex-col items-start">
                    <span className="text-[7px] md:text-[9px] font-bold text-slate-400 uppercase tracking-widest">Status</span>
                    <span className="text-[10px] md:text-xs font-black text-white">{Object.keys(roomData.guesses?.[roomData.currentRound] || {}).length} / {Object.keys(roomData.players || {}).length} Locked</span>
                  </div>
                  {!isSpectating ? (
                     <div className="flex flex-col items-end">
                       <span className="text-[7px] md:text-[9px] font-bold text-emerald-400 uppercase tracking-widest">Score</span>
                       <span className="text-xs md:text-sm font-black text-white font-mono tracking-tight">{(roomData.players?.[uid]?.score || 0).toLocaleString()}</span>
                     </div>
                  ) : (
                     <div className="flex flex-col items-end">
                       <span className="text-[7px] md:text-[9px] font-bold text-blue-400 uppercase tracking-widest flex items-center gap-1"><Eye size={10}/> Spectator</span>
                     </div>
                  )}
                </div>

                {/* Top 3 Player List embedded directly below the score panel */}
                <div className={`w-full bg-black/40 backdrop-blur-xl border-x border-b border-white/10 overflow-hidden transition-all duration-300 ${showLivePlayers ? 'max-h-[40vh] opacity-100' : 'max-h-0 opacity-0 border-b-transparent'}`} style={{ borderBottomLeftRadius: '1rem', borderBottomRightRadius: '1rem' }}>
                  <div className="p-1.5 overflow-y-auto custom-scrollbar max-h-[40vh] space-y-1">
                    <div className="text-[7px] md:text-[9px] font-black text-slate-500 uppercase tracking-widest px-2 pb-1 pt-1 flex items-center gap-1"><Trophy size={10}/> Live Rankings</div>
                    {top3.map((p, i) => {
                      const isMe = p.id === uid;
                      return (
                        <div key={p.id} className={`px-2 py-1.5 md:px-3 md:py-2 rounded-lg md:rounded-xl flex items-center justify-between gap-2 transition-all duration-300 ${isMe ? 'bg-blue-900/40 border border-blue-500/30' : 'bg-white/5 border border-white/5'}`}>
                           <div className="flex items-center gap-2 min-w-0">
                              <span className={`font-black text-[10px] md:text-xs w-3 md:w-4 text-center shrink-0 ${i === 0 ? 'text-yellow-400' : i === 1 ? 'text-slate-300' : i === 2 ? 'text-amber-600' : 'text-slate-500'}`}>{i + 1}</span>
                              <img src={p.avatar} alt={p.name} className={`w-4 h-4 md:w-5 md:h-5 rounded-full border shrink-0 border-slate-600`} style={{ backgroundColor: p.color }} />
                              <span className={`font-bold text-[9px] md:text-[11px] truncate ${isMe ? 'text-blue-400' : 'text-white'}`}>{isMe ? 'You' : p.name}</span>
                           </div>
                           <span className="text-[9px] md:text-[11px] font-mono font-bold text-emerald-400 shrink-0">
                             {p.score.toLocaleString()}
                           </span>
                        </div>
                      )
                    })}
                    {!amIInTop3 && myRank !== '-' && !isSpectating && (
                       <>
                         <div className="w-full h-px bg-white/10 my-1"></div>
                         <div className="px-2 py-1.5 md:px-3 md:py-2 rounded-lg md:rounded-xl flex items-center justify-between gap-2 transition-all duration-300 bg-blue-900/40 border border-blue-500/30">
                           <div className="flex items-center gap-2 min-w-0">
                              <span className="font-black text-[10px] md:text-xs w-3 md:w-4 text-center shrink-0 text-blue-400">{myRank}</span>
                              <img src={roomData.players[uid]?.avatar} alt="You" className="w-4 h-4 md:w-5 md:h-5 rounded-full border shrink-0 border-blue-400" style={{ backgroundColor: roomData.players[uid]?.color }} />
                              <span className="font-bold text-[9px] md:text-[11px] truncate text-blue-400">You</span>
                           </div>
                           <span className="text-[9px] md:text-[11px] font-mono font-bold text-emerald-400 shrink-0">
                             {(roomData.players[uid]?.score || 0).toLocaleString()}
                           </span>
                        </div>
                       </>
                    )}
                  </div>
                </div>
             </>
           )}
        </div>

        {/* MASSIVE MAP BUTTON (LOWER RIGHT) */}
        {!hasGuessed && !isSpectating && (
          <div className={`absolute bottom-4 right-4 md:bottom-10 md:right-10 z-40 transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] flex flex-col items-end pointer-events-auto
            ${isMapExpanded ? 'w-[95vw] h-[80vh] md:w-[800px] md:h-[600px] max-w-full rounded-2xl md:rounded-[2rem]' : 'w-40 h-14 md:w-64 md:h-20 hover:scale-[1.03] rounded-full'}`
          }>
            <div className={`w-full h-full shadow-[0_20px_50px_rgba(0,0,0,0.5)] overflow-hidden relative transition-colors duration-300 flex flex-col
              ${isMapExpanded ? 'bg-slate-900 border border-white/20 rounded-2xl md:rounded-[2rem]' : activeGuess ? 'bg-emerald-600 border border-emerald-400/50 rounded-full' : 'bg-blue-600/90 backdrop-blur-xl border border-blue-400/50 rounded-full'}`}>

              {!isMapExpanded ? (
                // Collapsed Pill Button
                <button onClick={() => setIsMapExpanded(true)} className="w-full h-full flex items-center justify-center gap-2 md:gap-3 text-white">
                  <MapIcon size={20} className="md:w-8 md:h-8 animate-[pulse_3s_ease-in-out_infinite]" />
                  <span className="font-black text-base md:text-2xl tracking-[0.1em] md:tracking-[0.15em] uppercase drop-shadow-md">
                    {activeGuess ? 'Guessed' : 'Open Map'}
                  </span>
                </button>
              ) : (
                // Expanded Map Panel
                <>
                  <div className="flex justify-between items-center p-3 md:p-4 bg-slate-900/80 backdrop-blur-md border-b border-white/10 shrink-0">
                     <span className="font-black text-sm md:text-lg tracking-widest uppercase flex items-center gap-2"><MapIcon size={16} className="md:w-5 md:h-5 text-blue-400"/> Map view</span>
                     <button onClick={() => setIsMapExpanded(false)} className="bg-white/10 hover:bg-red-500/80 p-1.5 md:p-2 rounded-full text-white transition-colors"><Minimize2 size={16} className="md:w-4 md:h-4" /></button>
                  </div>
                  <div className="flex-1 relative bg-[#e3f0f7]">
                    <GoogleMapCanvas interactable={true} activeGuess={activeGuess} activeGuessAvatar={roomData.players?.[uid]?.avatar} onGuessChange={setActiveGuess} isExpanded={isMapExpanded} />
                    
                    {/* Floating Lock Guess Button inside Map */}
                    <div className="absolute bottom-4 md:bottom-6 left-0 right-0 z-[400] flex justify-center pointer-events-none px-4 md:px-6">
                       <button onClick={() => submitGuess(activeGuess, false)} disabled={!activeGuess} 
                        className={`pointer-events-auto w-full md:w-auto px-8 md:px-12 py-4 md:py-5 rounded-full font-black text-lg md:text-2xl shadow-[0_0_40px_rgba(0,0,0,0.8)] transition-all duration-300 transform
                          ${activeGuess ? 'bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-white scale-100 translate-y-0 border border-emerald-300/50' : 'bg-slate-900/90 backdrop-blur-md text-slate-600 scale-95 translate-y-4 opacity-0 border border-white/5'}`}>
                         LOCK GUESS
                       </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // --- 4. REVAMPED RESULTS VIEW (Per Round Mobile Friendly) ---
  if (view === 'round_result' && roomData) {
     const currentLoc = roomData.locations?.[roomData.currentRound] || { lat: 0, lng: 0 };
     const uid = isSinglePlayer ? Object.keys(roomData.players || {})[0] : user?.uid;
     const isHost = isSinglePlayer || roomData.hostId === uid;
     const isSpectating = !isSinglePlayer && !(roomData.players || {})[uid];
     const allPlayers = Object.entries(roomData.players || {}); // SAFE GUARD
     const currentGuesses = roomData.guesses?.[roomData.currentRound] || {}; // SAFE GUARD
     const myGuess = currentGuesses[uid];
     const myDistance = myGuess && myGuess.distance !== null ? Math.round(myGuess.distance) : null;
     const mapGuesses = allPlayers.map(([pid, p]) => currentGuesses[pid] ? { ...currentGuesses[pid], color: p.color, label: p.name, avatar: p.avatar } : null).filter(Boolean);

     return (
       <div className="h-[100dvh] bg-[#050B14] text-white flex flex-col overflow-hidden font-sans relative">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_left,_var(--tw-gradient-stops))] from-blue-900/20 via-transparent to-transparent pointer-events-none"></div>
          
          <header className="px-4 py-3 md:px-6 md:py-4 border-b border-white/5 flex justify-between items-center bg-slate-900/50 backdrop-blur-xl relative z-10 shrink-0">
             <div className="flex items-center gap-3 md:gap-4">
               <button onClick={handleExit} className="bg-white/5 hover:bg-red-500/20 text-slate-300 hover:text-red-400 border border-white/10 hover:border-red-500/50 p-2 md:p-3 rounded-xl md:rounded-2xl transition-all"><Home size={18} className="md:w-5 md:h-5"/></button>
               <h2 className="text-base md:text-2xl font-black tracking-widest uppercase">Round Analysis</h2>
             </div>
             {isHost ? (
                 <button onClick={nextRound} className="bg-blue-600 hover:bg-blue-500 px-4 py-2 md:px-8 md:py-3 rounded-xl md:rounded-2xl font-bold flex items-center gap-2 md:gap-3 shadow-[0_0_20px_rgba(37,99,235,0.4)] transition-all active:scale-95 text-xs md:text-lg">
                   NEXT STAGE <ArrowRight size={16} className="md:w-5 md:h-5"/>
                 </button>
             ) : <span className="bg-white/5 px-4 py-2 md:px-6 md:py-3 rounded-xl md:rounded-2xl text-[10px] md:text-sm font-bold text-slate-400 tracking-widest uppercase border border-white/5 animate-pulse">Awaiting Host</span>}
          </header>

          {/* Flexible scrolling container allowing mobile to stack map and leaderboard neatly */}
          <div className="flex-1 overflow-hidden relative z-10 p-3 md:p-6">
             <div className="flex flex-col md:flex-row gap-4 md:gap-6 h-full min-h-0">
               
               {/* Map & Distance Panel */}
               <div className="flex-1 flex flex-col gap-3 md:gap-5 min-h-[40vh] md:min-h-0 overflow-hidden h-full">
                  
                  {isSpectating ? (
                     <div className="bg-gradient-to-r from-slate-900 to-slate-800 p-4 md:p-5 rounded-2xl md:rounded-3xl border border-white/10 shadow-2xl flex items-center justify-center shrink-0">
                        <h2 className="text-xl md:text-2xl font-black tracking-widest uppercase text-blue-400 flex items-center gap-3"><Eye size={24}/> Spectator Mode</h2>
                     </div>
                  ) : (
                     <div className="bg-gradient-to-r from-slate-900 to-slate-800 p-4 md:p-5 rounded-2xl md:rounded-3xl border border-white/10 shadow-2xl flex items-center justify-between shrink-0">
                       <div>
                         <h3 className="text-slate-400 text-[10px] md:text-xs font-bold uppercase tracking-[0.2em] mb-1">Impact Distance</h3>
                         <h2 className={`text-2xl md:text-4xl font-black tracking-tighter ${myDistance !== null ? 'text-emerald-400 drop-shadow-[0_0_15px_rgba(52,211,153,0.3)]' : 'text-red-500 drop-shadow-[0_0_15px_rgba(239,68,68,0.3)]'}`}>
                           {myDistance !== null ? `${myDistance.toLocaleString()} KM` : "SIGNAL LOST"}
                         </h2>
                       </div>
                       {myDistance !== null && <div className="text-right">
                         <p className="text-slate-400 text-[10px] md:text-xs font-bold uppercase tracking-[0.2em] mb-1">Points Gained</p>
                         <p className="text-xl md:text-3xl font-black text-blue-400">+{(myGuess?.score || 0).toLocaleString()}</p>
                       </div>}
                     </div>
                  )}
                  
                  {/* Fixed Map Container taking up all remaining empty space via flex-grow */}
                  <div className="relative rounded-2xl md:rounded-3xl overflow-hidden shadow-[0_0_40px_rgba(0,0,0,0.5)] border border-white/10 w-full flex-grow min-h-[300px] md:min-h-0 h-[40vh] md:h-auto bg-slate-900">
                    <GoogleMapCanvas interactable={false} actualLocation={currentLoc} guesses={mapGuesses} isExpanded={true} />
                  </div>
               </div>

               {/* Leaderboard Panel */}
               <div className="w-full md:w-[320px] lg:w-[400px] shrink-0 bg-slate-900/60 backdrop-blur-2xl rounded-2xl md:rounded-3xl border border-white/10 p-4 flex flex-col h-[35vh] md:h-full">
                  <h3 className="text-[10px] md:text-xs font-black text-slate-500 uppercase tracking-[0.2em] mb-4 flex items-center gap-2 shrink-0"><Trophy size={14} className="md:w-4 md:h-4"/> Operational Rankings</h3>
                  <div className="flex-1 overflow-y-auto space-y-2 custom-scrollbar pr-2 min-h-0">
                    {allPlayers.sort((a,b) => (currentGuesses[b[0]]?.score || 0) - (currentGuesses[a[0]]?.score || 0)).map(([pid, p], i) => (
                      <div key={pid} className="bg-white/5 hover:bg-white/10 transition-colors p-3 md:p-4 rounded-xl md:rounded-2xl border border-white/5 flex justify-between items-center group">
                         <div className="flex items-center gap-3 w-full min-w-0">
                            <span className="text-xs md:text-sm font-black text-slate-600 w-4 text-center shrink-0">{i+1}</span>
                            <img src={p.avatar} alt="av" className="w-8 h-8 md:w-10 md:h-10 rounded-full border-2 bg-slate-900 shadow-lg shrink-0" style={{ borderColor: p.color }} />
                            <div className="flex flex-col flex-1 min-w-0">
                               <span className="font-bold text-white text-sm md:text-base tracking-wide truncate">{p.name}</span>
                               <span className="text-[9px] md:text-[10px] font-mono font-bold tracking-widest text-slate-500 truncate mt-0.5">
                                 {currentGuesses[pid]?.distance ? `${Math.round(currentGuesses[pid].distance).toLocaleString()} KM` : 'M.I.A.'}
                               </span>
                            </div>
                         </div>
                         <div className="text-right flex flex-col items-end shrink-0 pl-3">
                            <span className="text-base md:text-xl font-black text-emerald-400">+{(currentGuesses[pid]?.score || 0).toLocaleString()}</span>
                         </div>
                      </div>
                    ))}
                  </div>
               </div>
             </div>
          </div>
       </div>
     );
  }

  // --- 5. REVAMPED GAME OVER VIEW ---
  if (view === 'game_over' && roomData) {
    const finalLeaderboard = Object.values(roomData.players || {}).sort((a, b) => (b.score || 0) - (a.score || 0)); // SAFE GUARD
    const isHost = isSinglePlayer || roomData.hostId === user?.uid;

    return (
      <div className="min-h-screen bg-[#050B14] text-white flex flex-col items-center py-10 md:py-12 px-4 font-sans overflow-y-auto relative custom-scrollbar">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-yellow-900/20 via-[#050B14] to-[#050B14] pointer-events-none"></div>
        
        <div className="relative z-10 flex flex-col items-center w-full max-w-4xl">
           <div className="relative mb-6 md:mb-8">
             <div className="absolute inset-0 bg-yellow-500/30 blur-[40px] md:blur-[60px] rounded-full pointer-events-none"></div>
             <Trophy size={60} className="md:w-[80px] md:h-[80px] text-yellow-400 relative z-10 drop-shadow-[0_0_20px_rgba(250,204,21,0.8)]" />
           </div>
           
           <h4 className="text-yellow-500/80 font-bold tracking-[0.2em] md:tracking-[0.3em] uppercase mb-2 text-[10px] md:text-sm">Operation Complete</h4>
           <h2 className="text-4xl sm:text-5xl md:text-7xl font-black mb-8 md:mb-12 bg-gradient-to-b from-white via-yellow-100 to-yellow-500 bg-clip-text text-transparent text-center leading-tight tracking-tighter drop-shadow-2xl px-2">
             {finalLeaderboard.length > 0 ? `${finalLeaderboard[0].name} Wins!` : 'No Players Joined'}
           </h2>
           
           <div className="w-full bg-slate-900/60 backdrop-blur-2xl rounded-2xl md:rounded-[2rem] border border-white/10 overflow-hidden mb-8 md:mb-10 shadow-[0_0_50px_rgba(0,0,0,0.5)]">
             <div className="bg-black/40 p-4 md:p-5 border-b border-white/5 flex justify-between px-6 md:px-8 text-[8px] md:text-[10px] font-black tracking-[0.2em] text-slate-500 uppercase">
               <span>Operative</span>
               <span>Final Score</span>
             </div>
             
             {/* Constrained leaderboard height to handle many players */}
             <div className="max-h-[40vh] md:max-h-[50vh] overflow-y-auto custom-scrollbar">
               {finalLeaderboard.map((p, i) => (
                 <div key={i} className={`flex justify-between items-center p-4 md:p-6 border-b border-white/5 transition-colors hover:bg-white/5 ${i === 0 ? 'bg-gradient-to-r from-yellow-500/10 to-transparent' : ''}`}>
                   <div className="flex items-center gap-4 md:gap-6 w-[60%]">
                     <span className={`text-xl md:text-3xl font-black w-6 md:w-8 text-center shrink-0 ${i === 0 ? 'text-yellow-400 drop-shadow-md' : i === 1 ? 'text-slate-300' : i === 2 ? 'text-amber-600' : 'text-slate-600'}`}>#{i + 1}</span>
                     <div className="relative shrink-0">
                        <img src={p.avatar} alt="av" className="w-10 h-10 md:w-14 md:h-14 rounded-full border-2 bg-slate-950 shadow-lg" style={{ borderColor: p.color }} />
                        {i === 0 && <div className="absolute -top-1 -right-1 md:-top-2 md:-right-2 bg-yellow-400 text-yellow-900 p-0.5 md:p-1 rounded-full"><Trophy size={10} className="md:w-3 md:h-3"/></div>}
                     </div>
                     <span className="text-lg md:text-2xl font-bold tracking-wide truncate">{p.name}</span>
                   </div>
                   <span className={`text-2xl md:text-4xl font-black tracking-tighter shrink-0 ${i === 0 ? 'text-yellow-400' : 'text-white'}`}>{(p.score || 0).toLocaleString()}</span>
                 </div>
               ))}
             </div>
           </div>

           <div className="flex flex-col sm:flex-row gap-3 md:gap-5 w-full justify-center px-4">
             {matchHistory.length > 0 && (
               <button onClick={() => { setShowHistoryModal(true); setSelectedHistoryRound(matchHistory[0]); }} className="w-full sm:w-auto bg-white/10 hover:bg-white/20 border border-white/10 px-6 md:px-8 py-4 md:py-5 rounded-xl md:rounded-2xl font-black tracking-widest text-xs md:text-sm transition-all flex justify-center items-center gap-2 md:gap-3">
                 <List size={16} className="md:w-[18px] md:h-[18px]"/> REVIEW MATCH
               </button>
             )}
             {isHost ? (
               <button onClick={isSinglePlayer ? startSinglePlayer : returnToLobby} className="w-full sm:w-auto bg-blue-600 hover:bg-blue-500 px-6 md:px-10 py-4 md:py-5 rounded-xl md:rounded-2xl font-black tracking-widest text-xs md:text-sm shadow-[0_0_20px_rgba(37,99,235,0.4)] flex justify-center items-center gap-2 md:gap-3 transition-transform active:scale-95">
                 <RotateCcw size={16} className="md:w-[18px] md:h-[18px]"/> {isSinglePlayer ? 'PLAY AGAIN' : 'RETURN TO LOBBY'}
               </button>
             ) : (
               <div className="w-full sm:w-auto bg-white/5 border border-white/10 px-6 md:px-8 py-4 md:py-5 rounded-xl md:rounded-2xl font-black tracking-widest text-xs md:text-sm flex justify-center items-center gap-2 md:gap-3 text-slate-400">
                 <div className="w-3 h-3 md:w-4 md:h-4 rounded-full bg-blue-500 animate-pulse"></div> WAITING FOR HOST
               </div>
             )}
             <button onClick={handleExit} className="w-full sm:w-auto bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 px-6 md:px-8 py-4 md:py-5 rounded-xl md:rounded-2xl font-black tracking-widest text-xs md:text-sm flex justify-center items-center gap-2 md:gap-3 transition-colors">
               <Home size={16} className="md:w-[18px] md:h-[18px]"/> MAIN MENU
             </button>
           </div>
        </div>

        {/* --- History Review Dashboard Mobile Friendly --- */}
        {showHistoryModal && (
          <div className="fixed inset-0 z-[500] flex items-center justify-center p-2 md:p-6 animate-in fade-in duration-200">
            <div className="absolute inset-0 bg-black/90 backdrop-blur-2xl" onClick={() => setShowHistoryModal(false)}></div>
            <div className="relative w-full max-w-7xl bg-slate-900/80 backdrop-blur-3xl rounded-2xl md:rounded-[2rem] border border-white/10 shadow-[0_0_100px_rgba(0,0,0,0.8)] flex flex-col md:flex-row h-[95dvh] md:h-[85vh] overflow-hidden transform animate-in zoom-in-95 duration-300">
               
               {/* History Sidebar */}
               <div className="w-full md:w-80 bg-black/40 border-b md:border-b-0 md:border-r border-white/5 flex flex-col h-[35vh] md:h-full shrink-0">
                  <div className="p-4 md:p-6 border-b border-white/5 flex justify-between items-center shrink-0">
                    <h3 className="font-black text-base md:text-xl tracking-widest uppercase flex items-center gap-2 md:gap-3 text-white"><List size={16} className="md:w-5 md:h-5 text-blue-500" /> Database</h3>
                    <button onClick={() => setShowHistoryModal(false)} className="md:hidden bg-white/10 p-1.5 rounded-full"><X size={16}/></button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-2 md:p-4 space-y-2 md:space-y-3 custom-scrollbar">
                    {matchHistory.map((h, i) => (
                      <button key={i} onClick={() => setSelectedHistoryRound(h)} className={`w-full text-left p-3 md:p-5 rounded-xl md:rounded-2xl border transition-all flex items-center justify-between group ${selectedHistoryRound?.round === h.round ? 'bg-blue-600 border-blue-400 shadow-[0_0_20px_rgba(37,99,235,0.3)]' : 'bg-white/5 border-white/5 hover:bg-white/10'}`}>
                        <div>
                           <p className={`text-[8px] md:text-[10px] font-bold tracking-[0.2em] uppercase mb-0.5 md:mb-1 ${selectedHistoryRound?.round === h.round ? 'text-blue-200' : 'text-slate-500'}`}>Round {h.round}</p>
                           <p className="font-black text-sm md:text-xl tracking-tight">{(h.score || 0).toLocaleString()} <span className="text-[10px] md:text-xs font-medium text-white/50">PTS</span></p>
                        </div>
                        <ChevronRight size={16} className={`md:w-5 md:h-5 transition-transform duration-300 ${selectedHistoryRound?.round === h.round ? 'translate-x-1 opacity-100 text-white' : 'opacity-0 -translate-x-2 text-slate-500 group-hover:opacity-100 group-hover:translate-x-0'}`} />
                      </button>
                    ))}
                  </div>
               </div>

               {/* Map Analyzer */}
               <div className="flex-1 relative flex flex-col bg-[#050B14] h-[60vh] md:h-full">
                  {selectedHistoryRound ? (
                    <div className="w-full h-full p-3 md:p-6 flex flex-col gap-3 md:gap-4 relative">
                      {/* Stat Bar overlay */}
                      <div className="absolute top-6 left-6 md:top-8 md:left-8 z-10 bg-slate-900/80 backdrop-blur-2xl p-3 md:p-5 rounded-xl md:rounded-2xl border border-white/10 shadow-2xl flex gap-4 md:gap-8 pointer-events-none">
                        <div>
                           <p className="text-[8px] md:text-[10px] font-black text-slate-500 tracking-[0.2em] uppercase mb-0.5 md:mb-1">Error Margin</p>
                           <p className="text-sm md:text-2xl font-black text-white">{selectedHistoryRound.distance ? `${Math.round(selectedHistoryRound.distance).toLocaleString()} KM` : 'N/A'}</p>
                        </div>
                        <div className="w-px bg-white/10"></div>
                        <div>
                           <p className="text-[8px] md:text-[10px] font-black text-slate-500 tracking-[0.2em] uppercase mb-0.5 md:mb-1">Score</p>
                           <p className="text-sm md:text-2xl font-black text-emerald-400">+{(selectedHistoryRound.score || 0).toLocaleString()}</p>
                        </div>
                      </div>
                      
                      {/* Map */}
                      <div className="flex-1 relative rounded-xl md:rounded-2xl overflow-hidden border border-white/10 shadow-inner bg-slate-900 min-h-[200px]">
                        <GoogleMapCanvas interactable={false} actualLocation={selectedHistoryRound.actual} guesses={selectedHistoryRound.guess ? [{ lat: selectedHistoryRound.guess.lat, lng: selectedHistoryRound.guess.lng, color: '#38bdf8', label: 'Your Pin' }] : []} isExpanded={true} />
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-slate-600 gap-2 md:gap-4">
                       <MapIcon size={48} className="md:w-16 md:h-16 opacity-20" />
                       <p className="font-bold tracking-widest uppercase text-xs md:text-sm">Select round data to analyze</p>
                    </div>
                  )}
                  <button onClick={() => setShowHistoryModal(false)} className="hidden md:flex absolute top-6 right-6 bg-slate-800/80 backdrop-blur-md p-4 rounded-full hover:bg-red-500 text-white transition-all shadow-xl border border-white/10 z-20"><X size={24}/></button>
               </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return <div className="min-h-screen bg-[#050B14] flex items-center justify-center"><div className="w-12 h-12 md:w-16 md:h-16 border-4 border-blue-900 border-t-blue-500 rounded-full animate-spin"></div></div>;
}
