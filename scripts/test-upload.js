require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const firebase = require('firebase/compat/app');
require('firebase/compat/storage');
const fs = require('fs');

const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  appId: process.env.FIREBASE_APP_ID
};

firebase.initializeApp(firebaseConfig);

async function upload() {
  try {
    const fileBuffer = fs.readFileSync('theme-images/dark.png');
    const storageRef = firebase.storage().ref('themes/dark.png');
    
    // We can use put on a buffer if we specify contentType or just use Uint8Array
    const arr = new Uint8Array(fileBuffer);
    const snapshot = await storageRef.put(arr, { contentType: 'image/png' });
    const url = await snapshot.ref.getDownloadURL();
    console.log('Success:', url);
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

upload();
