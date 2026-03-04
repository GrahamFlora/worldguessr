import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, updateDoc, onSnapshot } from 'firebase/firestore';
import { Globe, Play, Users, Trophy, ArrowRight, Home, Map as MapIcon, Minimize2, Copy, CheckCircle, RotateCcw, User } from 'lucide-react';

// --- CONFIGURATION ---
const GOOGLE_MAPS_API_KEY = "AIzaSyClIIqqJnkI-7BviXgT4oB44nBtSF6FkNI"; // Replace with your actual Google Maps API Key

// Replace this with your actual Firebase config object from your Firebase Console
const firebaseConfig = {
  apiKey: "AIzaSyBZf1hAPA_ozUE1UYS_LZy9CaEpj-WgEwM",
  authDomain: "worldguessr-a22f6.firebaseapp.com",
  projectId: "worldguessr-a22f6",
  storageBucket: "worldguessr-a22f6.firebasestorage.app",
  messagingSenderId: "135358594294",
  appId: "1:135358594294:web:ad349693defaed56d640d7",
  measurementId: "G-DNP29MZ0Q0"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// --- UTILS & FAST LOCATION ENGINE ---
let GOOGLE_PROMISE = null;
const loadGoogleMaps = () => {
  if (GOOGLE_PROMISE) return GOOGLE_PROMISE;
  GOOGLE_PROMISE = new Promise((resolve, reject) => {
    if (window.google && window.google.maps) return resolve(window.google);
    
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=geometry`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(window.google);
    script.onerror = (err) => reject(err);
    document.head.appendChild(script);
  });
  return GOOGLE_PROMISE;
};

// Known valid areas to prevent ocean loading loops
const KNOWN_LOCATIONS = [
  {lat: 48.8584, lng: 2.2945}, {lat: 40.6892, lng: -74.0445}, {lat: -33.8568, lng: 151.2153},
  {lat: -22.9519, lng: -43.2105}, {lat: 35.3606, lng: 138.7274}, {lat: 29.9792, lng: 31.1342},
  {lat: 41.8902, lng: 12.4922}, {lat: 27.1751, lng: 78.0421}, {lat: -13.1631, lng: -72.5450},
  {lat: 36.3932, lng: 25.4615}, {lat: 25.1972, lng: 55.2744}, {lat: 51.1789, lng: -1.8262},
  {lat: 37.8199, lng: -122.4783}, {lat: 30.3285, lng: 35.4444}, {lat: 13.4125, lng: 103.8670},
  {lat: 14.5995, lng: 120.9842}, {lat: 10.3157, lng: 123.8854}, {lat: 35.6762, lng: 139.6503},
  {lat: 37.5665, lng: 126.9780}, {lat: -37.8136, lng: 144.9631}, {lat: 34.0522, lng: -118.2437},
  {lat: 51.5074, lng: -0.1278}, {lat: 52.5200, lng: 13.4050}, {lat: -23.5505, lng: -46.6333},
  {lat: -34.6037, lng: -58.3816}, {lat: -33.9249, lng: 18.4241}, {lat: 1.3521, lng: 103.8198},
  {lat: 43.6532, lng: -79.3832}, {lat: 19.4326, lng: -99.1332}, {lat: 28.6139, lng: 77.2090}
];

const getRandomStreetViewLocation = (svService) => {
  return new Promise((resolve) => {
    let tries = 0;
    const attempt = () => {
      tries++;
      const base = KNOWN_LOCATIONS[Math.floor(Math.random() * KNOWN_LOCATIONS.length)];
      const lat = base.lat + (Math.random() - 0.5) * 0.5;
      const lng = base.lng + (Math.random() - 0.5) * 0.5;

      svService.getPanorama({ location: {lat, lng}, radius: 25000 }, (data, status) => {
        if (status === 'OK' && data && data.location && data.location.latLng) {
          resolve({
            lat: data.location.latLng.lat(),
            lng: data.location.latLng.lng(),
            pano: data.location.pano
          });
        } else {
          if (tries < 5) setTimeout(attempt, 50);
          else resolve({ lat: base.lat, lng: base.lng, pano: null });
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

const getAvatarUrl = (seed) => `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(seed)}&backgroundColor=1e293b&radius=50`;
const generateRoomCode = () => Math.random().toString(36).substring(2, 6).toUpperCase();
const getPlayerColor = (index, totalPlayers) => `hsl(${Math.floor((index / (totalPlayers || 1)) * 360)}, 80%, 55%)`;


// --- COMPONENTS ---
const StreetView = ({ location }) => {
  const containerRef = useRef(null);
  const svInstance = useRef(null);

  useEffect(() => {
    let isMounted = true;
    loadGoogleMaps().then((google) => {
      if (!isMounted || !containerRef.current) return;

      if (!svInstance.current) {
         svInstance.current = new google.maps.StreetViewPanorama(containerRef.current, {
             pov: { heading: 0, pitch: 0 },
             zoom: 1,
             addressControl: false,
             showRoadLabels: false,
             fullscreenControl: false,
             zoomControl: false,
             panControl: false,
             enableCloseButton: false,
             clickToGo: true,
             disableDefaultUI: false,
             linksControl: true,
             scrollwheel: true,
         });
      }

      if (location.pano) {
          svInstance.current.setPano(location.pano);
      } else {
          svInstance.current.setPosition({ lat: location.lat, lng: location.lng });
      }
    }).catch(err => console.error("Google Maps Failed to Load:", err));

    return () => { isMounted = false; };
  }, [location]);

  return <div ref={containerRef} className="w-full h-full bg-slate-900" style={{ pointerEvents: 'auto' }} />;
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
          center: { lat: 20, lng: 0 },
          zoom: 2,
          minZoom: 2,
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: false,
          scrollwheel: true,
          gestureHandling: "greedy", 
          zoomControl: true,
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

      const createPin = (color) => {
        return {
          path: google.maps.SymbolPath.CIRCLE,
          fillColor: color,
          fillOpacity: 1,
          strokeWeight: 2,
          strokeColor: 'white',
          scale: 8,
        };
      };

      if (interactable) {
        google.maps.event.clearListeners(map, 'click');
        map.addListener('click', (e) => onGuessChange({ lat: e.latLng.lat(), lng: e.latLng.lng() }));
        if (activeGuess) {
          const icon = activeGuessAvatar ? {
            url: activeGuessAvatar,
            scaledSize: new google.maps.Size(36, 36),
            anchor: new google.maps.Point(18, 18)
          } : createPin('#ef4444');
          markersRef.current.push(new google.maps.Marker({ position: activeGuess, map, icon }));
        }
      } else if (actualLocation) {
        google.maps.event.clearListeners(map, 'click'); 
        
        const actualPos = { lat: actualLocation.lat, lng: actualLocation.lng };
        markersRef.current.push(new google.maps.Marker({ position: actualPos, map, icon: createPin('#22c55e'), zIndex: 999 }));
        const bounds = new google.maps.LatLngBounds();
        bounds.extend(actualPos);

        if (guesses && guesses.length > 0) {
          guesses.forEach((guess) => {
            if (!guess) return;
            const pos = { lat: guess.lat, lng: guess.lng };
            
            const icon = guess.avatar ? {
              url: guess.avatar,
              scaledSize: new google.maps.Size(36, 36),
              anchor: new google.maps.Point(18, 18)
            } : createPin(guess.color);

            markersRef.current.push(new google.maps.Marker({ position: pos, map, icon: icon, title: guess.label }));
            polylinesRef.current.push(new google.maps.Polyline({ path: [pos, actualPos], geodesic: true, strokeColor: guess.color, strokeOpacity: 0.8, strokeWeight: 3, map }));
            bounds.extend(pos);
          });
        }

        map.fitBounds(bounds);
      }
    }).catch(err => console.error(err));

    return () => { isMounted = false; };
  }, [interactable, actualLocation, guesses, activeGuess, activeGuessAvatar]);

  useEffect(() => {
    if (mapInstance.current && window.google) {
      setTimeout(() => window.google.maps.event.trigger(mapInstance.current, 'resize'), 300);
    }
  }, [isExpanded]);

  return <div ref={mapContainerRef} className="w-full h-full bg-[#e3f0f7]" onWheel={(e) => e.stopPropagation()} style={{ pointerEvents: 'auto' }} />;
};


// --- MAIN APP COMPONENT ---
export default function App() {
  const [user, setUser] = useState(null);
  const [view, setView] = useState('menu'); 
  const [playerName, setPlayerName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [roomData, setRoomData] = useState(null);
  const [isSinglePlayer, setIsSinglePlayer] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [isGeneratingLocations, setIsGeneratingLocations] = useState(false);
  const [isJoining, setIsJoining] = useState(false);

  const [activeGuess, setActiveGuess] = useState(null);
  const [isMapExpanded, setIsMapExpanded] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

  // Parse URL for invite code (Cleaned for production Netlify URL)
  useEffect(() => {
     const hashStr = window.location.hash.replace('#', '');
     if (hashStr && hashStr.length === 4) {
         setJoinCode(hashStr.toUpperCase());
     }
  }, []);

  // Auth & Prefetch
  useEffect(() => {
    const initAuth = async () => {
      try {
        await signInAnonymously(auth);
      } catch (err) { 
        console.error("Auth Error:", err); 
        setErrorMsg("Failed to connect to database. Check Firebase config.");
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    loadGoogleMaps().catch(e => console.error("Prefetch Map Failed:", e));
    return () => unsubscribe();
  }, []);

  // Sync Room Data
  useEffect(() => {
    if (!user || !roomCode || isSinglePlayer) return;

    const roomRef = doc(db, 'rooms', roomCode); // Root collection for production
    const unsubscribe = onSnapshot(roomRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        setRoomData(data);
        
        if (['lobby', 'playing', 'round_result', 'game_over'].includes(data.status)) {
           setView(data.status);
        }
        
        if (data.status === 'playing' && data.hostId === user.uid) {
          const currentGuesses = data.guesses[data.currentRound] || {};
          if (Object.keys(currentGuesses).length === Object.keys(data.players).length) {
             const updatedPlayers = { ...data.players };
             Object.entries(currentGuesses).forEach(([uid, guess]) => updatedPlayers[uid].score += guess.score);
             updateDoc(roomRef, { status: 'round_result', players: updatedPlayers });
          }
        }
      } else {
        setErrorMsg('Room closed or disconnected.');
        setView('menu');
      }
    });

    return () => unsubscribe();
  }, [user, roomCode, isSinglePlayer]);


  // --- ACTIONS ---

  const getShareLink = () => {
    // Perfect clean URL for Netlify production
    return `${window.location.origin}/#${roomCode}`;
  };

  const copyLink = () => {
    const url = getShareLink();
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(url).then(() => {
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 2000);
      }).catch(() => fallbackCopy(url));
    } else {
      fallbackCopy(url);
    }
  };

  const fallbackCopy = (text) => {
    try {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.top = "0";
      textArea.style.left = "0";
      textArea.style.position = "fixed";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      if (document.execCommand('copy')) {
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 2000);
      }
      document.body.removeChild(textArea);
    } catch (err) {
      alert(`Please manually copy: ${text}`);
    }
  };

  const createRoom = async () => {
    if (!user || !playerName.trim() || isJoining || isGeneratingLocations) return;
    setIsJoining(true);
    setIsSinglePlayer(false);
    setErrorMsg('');
    const code = generateRoomCode();
    const roomRef = doc(db, 'rooms', code); // Using root 'rooms' collection
    
    try {
      await setDoc(roomRef, {
        status: 'lobby', hostId: user.uid, settings: { numRounds: 5 },
        players: { [user.uid]: { name: playerName.trim().substring(0, 15), avatar: getAvatarUrl(user.uid), score: 0, color: getPlayerColor(0, 1) } },
        locations: [], currentRound: 0, guesses: {}
      });

      setRoomCode(code);
      setView('lobby');
    } catch (err) {
      console.error("Create Room Error:", err);
      setErrorMsg("Failed to connect to Firebase. Check your Firestore Database Rules.");
    } finally {
      setIsJoining(false);
    }
  };

  const joinRoom = async () => {
    if (!user || !playerName.trim() || joinCode.length !== 4 || isJoining || isGeneratingLocations) return;
    setIsJoining(true);
    setIsSinglePlayer(false);
    setErrorMsg('');
    const code = joinCode.toUpperCase();
    const roomRef = doc(db, 'rooms', code);
    
    try {
      const snap = await getDoc(roomRef); // Changed to standard getDoc for custom Firebase
      if (!snap.exists()) {
        setErrorMsg('Room not found.');
      } else {
        const data = snap.data();
        if (data.status !== 'lobby' && data.status !== 'game_over') {
          setErrorMsg('Game in progress.');
        } else {
          await updateDoc(roomRef, { [`players.${user.uid}`]: { name: playerName.trim().substring(0, 15), avatar: getAvatarUrl(user.uid), score: 0, color: getPlayerColor(Object.keys(data.players).length, 8) } });
          setRoomCode(code);
          setView('lobby');
        }
      }
    } catch (e) { setErrorMsg('Error joining room.'); }
    setIsJoining(false);
  };

  const startSinglePlayer = async () => {
     if (isGeneratingLocations) return;
     setIsGeneratingLocations(true);
     setIsSinglePlayer(true);

     try {
      const google = await loadGoogleMaps();
      const svService = new google.maps.StreetViewService();
      
      const locations = await Promise.all([1, 2, 3, 4, 5].map(() => getRandomStreetViewLocation(svService)));
      const uid = user ? user.uid : 'solo';
      
      setRoomData({
         status: 'playing', hostId: uid, settings: { numRounds: 5 },
         players: { [uid]: { name: playerName.trim().substring(0, 15) || 'Guest', avatar: getAvatarUrl(uid), score: 0, color: '#3b82f6' } },
         locations, currentRound: 0, guesses: {}
      });

      setView('playing');
      setIsMapExpanded(false);
      setActiveGuess(null);
     } catch (err) {
        setErrorMsg("Failed to start practice mode.");
     } finally {
        setIsGeneratingLocations(false);
     }
  };

  const startMatch = async () => {
    if (!roomData || roomData.hostId !== user.uid || isGeneratingLocations) return;
    setIsGeneratingLocations(true);
    
    try {
      const google = await loadGoogleMaps();
      const svService = new google.maps.StreetViewService();
      
      const locations = await Promise.all([1, 2, 3, 4, 5].map(() => getRandomStreetViewLocation(svService)));
      const playersObj = { ...roomData.players };
      Object.keys(playersObj).forEach((uid, i) => { playersObj[uid].score = 0; playersObj[uid].color = getPlayerColor(i, Object.keys(playersObj).length); });

      await updateDoc(doc(db, 'rooms', roomCode), {
        status: 'playing', locations, currentRound: 0, players: playersObj, guesses: {}
      });
      
      setIsMapExpanded(false);
      setActiveGuess(null);
    } catch (err) {
      setErrorMsg("Failed to generate locations.");
    } finally {
      setIsGeneratingLocations(false);
    }
  };

  const submitGuess = async () => {
    if (!user || !roomData || !activeGuess) return;
    const actualLoc = roomData.locations[roomData.currentRound];
    const distance = calculateDistance(activeGuess.lat, activeGuess.lng, actualLoc.lat, actualLoc.lng);
    const score = calculateScore(distance);
    const uid = isSinglePlayer ? Object.keys(roomData.players)[0] : user.uid;

    if (isSinglePlayer) {
      setRoomData(prev => ({
          ...prev, status: 'round_result',
          guesses: { ...prev.guesses, [prev.currentRound]: { [uid]: { ...activeGuess, distance, score } } },
          players: { ...prev.players, [uid]: { ...prev.players[uid], score: prev.players[uid].score + score } }
      }));
    } else {
      await updateDoc(doc(db, 'rooms', roomCode), {
        [`guesses.${roomData.currentRound}.${uid}`]: { ...activeGuess, distance, score }
      });
    }
    setActiveGuess(null);
    setIsMapExpanded(false);
  };

  const forceReveal = async () => {
    if (isSinglePlayer) return;
    const currentGuesses = roomData.guesses[roomData.currentRound] || {};
    const updatedPlayers = { ...roomData.players };
    Object.entries(currentGuesses).forEach(([uid, guess]) => { updatedPlayers[uid].score += guess.score; });
    await updateDoc(doc(db, 'rooms', roomCode), { status: 'round_result', players: updatedPlayers });
  };

  const nextRound = async () => {
    const isGameOver = roomData.currentRound + 1 >= roomData.settings.numRounds;
    if (isSinglePlayer) {
      setRoomData(prev => ({ ...prev, status: isGameOver ? 'game_over' : 'playing', currentRound: prev.currentRound + 1 }));
    } else {
      await updateDoc(doc(db, 'rooms', roomCode), {
        status: isGameOver ? 'game_over' : 'playing', currentRound: roomData.currentRound + 1
      });
    }
    setActiveGuess(null);
    setIsMapExpanded(false);
  };

  const handleExit = () => {
    setView('menu');
    setIsSinglePlayer(false);
    setRoomCode('');
    setRoomData(null);
    setActiveGuess(null);
    setIsMapExpanded(false);
    
    // Catch history manipulation errors in restricted blob/iframe preview environments
    try {
      window.history.replaceState(null, '', window.location.pathname);
    } catch (e) {
      console.warn("Could not clear URL hash due to environment restrictions (safe to ignore).");
    }
  };

  // --- RENDERERS ---

  if (view === 'menu') {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col items-center justify-center p-4 md:p-6 font-sans">
        <div className="bg-slate-800 p-6 md:p-12 rounded-3xl shadow-2xl border border-slate-700 flex flex-col items-center max-w-md w-full text-center">
          <Globe size={64} className="text-blue-500 mb-6 drop-shadow-[0_0_15px_rgba(59,130,246,0.5)] animate-pulse" />
          <h1 className="text-4xl md:text-5xl font-black tracking-tight mb-2 bg-gradient-to-br from-white to-slate-400 bg-clip-text text-transparent">WorldGuessr</h1>
          <p className="text-slate-400 mb-8 text-sm md:text-base">Pinpoint random locations around the globe.</p>
          
          <input 
            type="text" placeholder="Your Nickname" value={playerName}
            onChange={(e) => setPlayerName(e.target.value)} maxLength={15}
            className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-4 mb-6 focus:outline-none focus:border-blue-500 text-white font-bold text-center text-lg md:text-xl"
          />

          <div className="w-full grid grid-cols-2 gap-3 md:gap-4 mb-6">
             <button 
                onClick={startSinglePlayer} disabled={isGeneratingLocations || isJoining || !playerName.trim()}
                className="w-full bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white p-3 md:p-4 rounded-xl font-bold transition-all flex flex-col items-center gap-2 justify-center"
              >
                {isGeneratingLocations && isSinglePlayer ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : <><User size={24} /> <span className="text-sm md:text-base">Practice</span></>}
              </button>

              <button 
                onClick={createRoom} disabled={!playerName.trim() || isJoining || isGeneratingLocations}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white p-3 md:p-4 rounded-xl font-bold transition-all shadow-lg flex flex-col justify-center items-center gap-2"
              >
                {isJoining && !isSinglePlayer ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : <><Users size={24} /> <span className="text-sm md:text-base">Host Game</span></>}
              </button>
          </div>

          <div className="w-full border-t border-slate-700 my-4 relative">
            <span className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-slate-800 px-4 text-slate-500 text-xs md:text-sm font-bold">OR JOIN</span>
          </div>

          <div className="w-full flex gap-2 mt-4">
            <input 
              type="text" placeholder="4-Letter Code" value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.substring(0,4).toUpperCase())}
              className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 md:py-4 focus:outline-none focus:border-blue-500 text-white font-mono font-bold text-center text-lg tracking-widest uppercase"
            />
            <button 
              onClick={joinRoom} disabled={!playerName.trim() || joinCode.length !== 4 || isJoining}
              className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 text-white px-4 md:px-6 rounded-xl font-bold transition-all shadow-lg flex justify-center items-center min-w-[70px] md:min-w-[80px]"
            >
              Join
            </button>
          </div>
          {errorMsg && <p className="text-red-400 mt-4 font-bold text-sm">{errorMsg}</p>}
        </div>
      </div>
    );
  }

  if (view === 'lobby' && !isSinglePlayer && roomData) {
    const isHost = roomData.hostId === user?.uid;
    const playersList = Object.values(roomData.players);
    const shareUrl = getShareLink();

    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col items-center py-6 md:py-12 px-4 font-sans">
        <div className="w-full max-w-3xl bg-slate-800 p-6 md:p-8 rounded-3xl shadow-2xl border border-slate-700">
          <div className="flex flex-col items-center mb-8 md:mb-10 border-b border-slate-700 pb-6 md:pb-8">
            <p className="text-slate-400 font-bold tracking-widest uppercase mb-2 text-sm">Room Code</p>
            <h2 className="text-5xl md:text-7xl font-black font-mono tracking-widest text-blue-400 select-all cursor-text mb-6">{roomCode}</h2>
            
            <div className="w-full flex flex-col md:flex-row gap-2">
               <input type="text" readOnly value={shareUrl} className="flex-1 bg-slate-900 text-slate-400 p-3 md:px-4 rounded-xl border border-slate-700 font-mono text-xs md:text-sm text-center md:text-left" />
               <button onClick={copyLink} className="bg-slate-700 hover:bg-slate-600 p-3 md:px-6 md:py-3 rounded-xl font-bold flex justify-center items-center gap-2 transition-colors">
                 {copySuccess ? <CheckCircle size={20} className="text-emerald-400" /> : <Copy size={20} />} <span className="md:inline">Copy Link</span>
               </button>
            </div>
          </div>

          <div className="mb-8 md:mb-10">
            <h3 className="text-lg md:text-xl font-bold mb-4 flex items-center gap-2">
              <Users className="text-emerald-400" /> Players Joined ({playersList.length})
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 md:gap-4">
              {playersList.map((p, i) => (
                <div key={i} className="bg-slate-900 border border-slate-700 p-3 md:p-4 rounded-2xl flex flex-col items-center text-center">
                  <img src={p.avatar} alt={p.name} className="w-12 h-12 md:w-16 md:h-16 rounded-full bg-slate-800 mb-2 md:mb-3 border-2 border-slate-700" />
                  <span className="font-bold text-white truncate w-full text-sm md:text-base">{p.name}</span>
                </div>
              ))}
            </div>
          </div>

          {isHost ? (
            <button 
              onClick={startMatch} 
              disabled={isGeneratingLocations}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white p-4 md:p-5 rounded-2xl font-black text-xl md:text-2xl shadow-lg flex justify-center items-center gap-3"
            >
              {isGeneratingLocations ? <><div className="w-5 h-5 md:w-6 md:h-6 border-4 border-white border-t-transparent rounded-full animate-spin"></div> Loading Locations...</> : <>Start Game <ArrowRight size={24} /></>}
            </button>
          ) : (
            <div className="w-full bg-slate-900 text-slate-400 p-4 md:p-5 rounded-2xl font-bold text-base md:text-xl text-center border border-slate-700 flex justify-center items-center gap-3">
               <div className="w-5 h-5 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
               Waiting for host to start...
            </div>
          )}
        </div>
      </div>
    );
  }

  if (view === 'playing' && roomData) {
    const currentLoc = roomData.locations[roomData.currentRound];
    const uid = isSinglePlayer ? Object.keys(roomData.players)[0] : user.uid;
    const hasGuessed = !!roomData.guesses[roomData.currentRound]?.[uid];
    const guessesCount = Object.keys(roomData.guesses[roomData.currentRound] || {}).length;
    const totalPlayers = Object.keys(roomData.players).length;
    const isHost = isSinglePlayer || roomData.hostId === uid;
    const myAvatar = roomData.players[uid]?.avatar;

    return (
      <div className="fixed inset-0 bg-black text-white font-sans flex flex-col">
        <div className="absolute inset-0 z-0 bg-black">
          <StreetView location={currentLoc} />
          <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-transparent to-transparent pointer-events-none z-10"></div>
        </div>

        <header className="relative z-20 p-4 md:p-6 flex justify-between items-start pointer-events-none">
          <div className="flex items-start gap-2 md:gap-3">
             <button onClick={handleExit} className="pointer-events-auto bg-black/60 hover:bg-black/80 p-2 md:p-3 rounded-xl md:rounded-2xl border border-white/10 backdrop-blur-md text-slate-300 hover:text-white transition-colors shadow-2xl">
                <Home size={20} className="md:w-6 md:h-6" />
             </button>
             <div className="bg-black/60 backdrop-blur-md border border-white/10 px-4 py-2 md:px-6 md:py-3 rounded-xl md:rounded-2xl pointer-events-auto shadow-2xl">
               <h1 className="text-xs md:text-sm font-bold text-slate-400 uppercase tracking-widest">{isSinglePlayer ? 'Practice Mode' : `Round ${roomData.currentRound + 1} / ${roomData.settings.numRounds}`}</h1>
               <p className="text-lg md:text-2xl font-black text-white shadow-black drop-shadow-md">Look around!</p>
             </div>
          </div>
          <div className="bg-black/60 backdrop-blur-md border border-white/10 px-4 py-2 md:px-6 md:py-3 rounded-xl md:rounded-2xl pointer-events-auto flex flex-col items-end shadow-2xl">
             <span className="text-slate-400 text-xs md:text-sm font-bold">Your Score</span>
             <span className="text-lg md:text-2xl font-black text-emerald-400">{roomData.players[uid]?.score.toLocaleString()}</span>
          </div>
        </header>

        {hasGuessed && (
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-30 bg-black/80 backdrop-blur-xl border border-white/20 p-6 md:p-8 rounded-3xl text-center shadow-2xl animate-in zoom-in-95 duration-300 w-[90%] max-w-sm">
             <CheckCircle size={48} className="text-emerald-500 mx-auto mb-4 md:w-16 md:h-16" />
             <h2 className="text-2xl md:text-3xl font-black text-white mb-2">Guess Locked!</h2>
             {!isSinglePlayer && (
                 <>
                   <p className="text-slate-400 text-sm md:text-lg mb-6">Waiting for other players... ({guessesCount}/{totalPlayers})</p>
                   {isHost && guessesCount < totalPlayers && (
                     <button onClick={forceReveal} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded-xl text-xs md:text-sm font-bold text-slate-300">
                       Force Reveal Results
                     </button>
                   )}
                 </>
             )}
          </div>
        )}

        {!hasGuessed && (
          <div className={`absolute bottom-4 right-4 md:bottom-8 md:right-8 z-40 transition-all duration-500 ease-in-out flex flex-col items-end pointer-events-auto
            ${isMapExpanded ? 'w-[92vw] h-[65vh] md:w-[800px] md:h-[600px] max-w-full' : 'w-20 h-20 md:w-32 md:h-32 hover:scale-105'}`
          }>
            <div className={`w-full h-full bg-slate-800 rounded-2xl md:rounded-3xl shadow-2xl border-2 md:border-4 overflow-hidden relative transition-colors duration-300 ${activeGuess ? 'border-emerald-500' : 'border-slate-700'}`}>
              {!isMapExpanded ? (
                <button onClick={() => setIsMapExpanded(true)} className="w-full h-full flex flex-col items-center justify-center bg-slate-800 hover:bg-slate-700 text-slate-300 p-2 text-center">
                  <MapIcon size={24} className="mb-1 md:w-8 md:h-8" />
                  <span className="font-bold text-[10px] md:text-sm">Open Map</span>
                </button>
              ) : (
                <>
                  <button onClick={() => setIsMapExpanded(false)} className="absolute top-2 right-2 md:top-4 md:right-4 z-[400] bg-black/60 hover:bg-black p-2 rounded-full text-white backdrop-blur-sm shadow-md border border-white/20">
                    <Minimize2 size={16} className="md:w-5 md:h-5" />
                  </button>
                  <GoogleMapCanvas interactable={true} activeGuess={activeGuess} activeGuessAvatar={myAvatar} onGuessChange={setActiveGuess} isExpanded={isMapExpanded} />
                  <div className="absolute bottom-4 left-0 right-0 z-[400] flex justify-center pointer-events-none px-4">
                     <button onClick={submitGuess} disabled={!activeGuess} className={`pointer-events-auto w-full md:w-auto px-8 py-3 md:py-4 rounded-xl md:rounded-full font-black text-lg md:text-xl shadow-2xl transition-all transform border border-white/20 ${activeGuess ? 'bg-emerald-600 hover:bg-emerald-500 text-white scale-100' : 'bg-slate-900/80 backdrop-blur-sm text-slate-500 scale-90 opacity-0'}`}>
                       Lock Guess
                     </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (view === 'round_result' && roomData) {
     const currentLoc = roomData.locations[roomData.currentRound];
     const uid = isSinglePlayer ? Object.keys(roomData.players)[0] : user.uid;
     const isHost = isSinglePlayer || roomData.hostId === uid;
     
     const allPlayers = Object.entries(roomData.players);
     const currentGuesses = roomData.guesses[roomData.currentRound] || {};
     
     const myGuess = currentGuesses[uid];
     const myDistance = myGuess ? Math.round(myGuess.distance) : null;

     const mapGuesses = allPlayers.map(([playerId, player]) => {
        const guess = currentGuesses[playerId];
        if (!guess) return null;
        return { lat: guess.lat, lng: guess.lng, color: player.color, label: player.name, avatar: player.avatar };
     }).filter(Boolean);
     
     const roundLeaderboard = allPlayers.map(([playerId, player]) => {
        const guess = currentGuesses[playerId];
        return { name: player.name, avatar: player.avatar, color: player.color, roundScore: guess?.score || 0, roundDist: guess?.distance || 0 };
     }).sort((a,b) => b.roundScore - a.roundScore);

     return (
       <div className="min-h-screen bg-slate-900 text-white flex flex-col overflow-hidden">
          <header className="p-4 md:p-6 border-b border-slate-800 flex justify-between items-center bg-slate-950/50 shrink-0">
             <div className="flex items-center gap-3 md:gap-4">
               <button onClick={handleExit} className="bg-slate-800 hover:bg-slate-700 p-2 md:p-3 rounded-xl transition-colors">
                 <Home size={18} className="text-slate-300 md:w-5 md:h-5"/>
               </button>
               <h2 className="text-lg md:text-2xl font-black">Round Results</h2>
             </div>
             {isHost ? (
                 <button onClick={nextRound} className="bg-blue-600 px-4 md:px-8 py-2 md:py-3 rounded-xl font-bold flex items-center gap-2 shadow-lg text-sm md:text-base">Next <ArrowRight size={16} className="md:w-5 md:h-5"/></button>
             ) : (
                 <div className="text-slate-400 font-bold animate-pulse text-sm md:text-base">Waiting for host...</div>
             )}
          </header>
          <div className="flex-1 grid md:grid-cols-3 overflow-hidden flex-col md:flex-row">
             <div className="md:col-span-2 relative flex flex-col p-4 md:p-6 gap-3 md:gap-4 h-[50vh] md:h-auto">
                <div className="bg-slate-800 p-3 md:p-4 rounded-xl md:rounded-2xl border border-slate-700 text-center shrink-0 shadow-lg">
                  <h3 className="text-slate-400 text-xs md:text-sm font-bold uppercase tracking-widest mb-1">Your Distance</h3>
                  <h2 className="text-xl md:text-3xl font-black text-green-400 truncate">
                    {myDistance !== null ? `${myDistance.toLocaleString()} km from location` : "No Guess"}
                  </h2>
                </div>
                <div className="relative rounded-xl md:rounded-2xl overflow-hidden shadow-2xl border-2 md:border-4 border-slate-700 flex-1 min-h-[200px] md:min-h-[300px]">
                  <GoogleMapCanvas interactable={false} actualLocation={currentLoc} guesses={mapGuesses} isExpanded={true} />
                </div>
             </div>
             <div className="bg-slate-800 p-4 md:p-6 space-y-3 md:space-y-4 overflow-y-auto border-t md:border-t-0 md:border-l border-slate-700 custom-scrollbar h-[50vh] md:h-auto md:max-h-[calc(100vh-80px)]">
                <h3 className="text-xs md:text-sm font-bold text-slate-500 uppercase tracking-widest">Rankings</h3>
                {roundLeaderboard.map((p, i) => (
                  <div key={i} className="bg-slate-900 p-3 md:p-4 rounded-xl md:rounded-2xl border border-slate-700 flex justify-between items-center shadow-sm">
                     <div className="flex items-center gap-2 md:gap-3 w-[60%]">
                        <div className="w-6 h-6 md:w-8 md:h-8 rounded-full flex items-center justify-center font-bold text-xs md:text-base shrink-0" style={{ backgroundColor: p.color, color: 'white' }}>{i+1}</div>
                        <img src={p.avatar} alt="avatar" className="w-8 h-8 md:w-10 md:h-10 rounded-full border-2 bg-slate-800 shrink-0" style={{ borderColor: p.color }} />
                        <span className="font-bold truncate text-white text-sm md:text-base">{p.name}</span>
                     </div>
                     <div className="text-right">
                        <div className="text-base md:text-xl font-black text-emerald-400">+{p.roundScore}</div>
                        <div className="text-[10px] md:text-xs font-mono text-slate-500">{p.roundDist > 0 ? `${Math.round(p.roundDist).toLocaleString()} km` : 'No Guess'}</div>
                     </div>
                  </div>
                ))}
             </div>
          </div>
       </div>
     );
  }

  if (view === 'game_over' && roomData) {
    const uid = isSinglePlayer ? Object.keys(roomData.players)[0] : user?.uid;
    const isHost = isSinglePlayer || roomData.hostId === uid;
    
    const finalLeaderboard = Object.values(roomData.players)
      .sort((a, b) => b.score - a.score);

    return (
      <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center py-8 md:py-12 px-4 font-sans overflow-y-auto">
        <Trophy size={64} className="text-yellow-400 mb-4 md:mb-6 md:w-[80px] md:h-[80px] drop-shadow-[0_0_20px_rgba(250,204,21,0.5)]" />
        <h2 className="text-4xl md:text-6xl font-black mb-8 md:mb-10 bg-gradient-to-r from-yellow-300 to-yellow-600 bg-clip-text text-transparent text-center leading-tight">
          {finalLeaderboard[0].name} Wins!
        </h2>
        
        <div className="w-full max-w-3xl bg-slate-800 rounded-2xl md:rounded-3xl border border-slate-700 overflow-hidden mb-8 md:mb-12 shadow-2xl">
          <div className="bg-slate-900 p-3 md:p-4 border-b border-slate-700 font-bold text-slate-400 flex justify-between px-4 md:px-8 text-sm md:text-base">
            <span>Rank & Player</span>
            <span>Final Score</span>
          </div>
          <div className="max-h-[50vh] overflow-y-auto custom-scrollbar">
            {finalLeaderboard.map((p, i) => (
              <div key={i} className={`flex justify-between items-center p-4 md:p-6 border-b border-slate-700/50 ${i === 0 ? 'bg-yellow-500/10' : 'hover:bg-slate-700/30'}`}>
                <div className="flex items-center gap-3 md:gap-4">
                  <span className={`text-xl md:text-2xl font-black w-6 md:w-8 ${i === 0 ? 'text-yellow-400' : i === 1 ? 'text-slate-300' : i === 2 ? 'text-amber-600' : 'text-slate-500'}`}>
                    #{i + 1}
                  </span>
                  <img src={p.avatar} alt="avatar" className="w-10 h-10 md:w-12 md:h-12 rounded-full border-2 bg-slate-800" style={{ borderColor: p.color }} />
                  <span className="text-xl md:text-2xl font-bold truncate max-w-[120px] md:max-w-xs">{p.name}</span>
                </div>
                <span className="text-2xl md:text-3xl font-black text-white">{p.score.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row justify-center gap-3 md:gap-4 w-full sm:w-auto">
          {isHost && (
            <button 
              onClick={isSinglePlayer ? startSinglePlayer : startMatch} 
              disabled={isGeneratingLocations}
              className="bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:cursor-not-allowed w-full sm:w-auto px-6 md:px-8 py-3 md:py-4 rounded-xl font-bold flex justify-center items-center gap-2 md:gap-3 text-base md:text-lg transition-transform active:scale-95 shadow-lg"
            >
              {isGeneratingLocations ? <div className="w-4 h-4 md:w-5 md:h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : <RotateCcw size={20} className="md:w-6 md:h-6"/>}
              {isGeneratingLocations ? 'Loading Map...' : 'Play Again'}
            </button>
          )}
          <button onClick={handleExit} className="bg-slate-800 hover:bg-slate-700 border border-slate-600 w-full sm:w-auto px-6 md:px-8 py-3 md:p-4 rounded-xl font-bold flex justify-center items-center gap-2 md:gap-3 text-base md:text-lg transition-transform active:scale-95 shadow-lg">
            <Home size={20} className="md:w-6 md:h-6"/> Exit
          </button>
        </div>
      </div>
    );
  }

  return <div className="min-h-screen bg-slate-900 flex items-center justify-center"><div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div></div>;
}