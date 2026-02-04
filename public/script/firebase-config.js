import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyD-7M8M-y5hmHiEIztFTSFzMIcEZt3MdpE",
    authDomain: "camerasriobranco.firebaseapp.com",
    projectId: "camerasriobranco",
    storageBucket: "camerasriobranco.appspot.com",
    messagingSenderId: "84020805734",
    appId: "1:84020805734:web:9904063112bd0b649f2da7",
    // Web Client ID: 84020805734-ggo4hq1rmp2u915bqj5sg4otoq2v39in.apps.googleusercontent.com
    measurementId: "G-Y6B72KFF66"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export { app, auth, db };
