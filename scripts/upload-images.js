const fs = require('fs');
const path = require('path');

const USE_EMULATOR = process.argv.includes('--emulator');
const PROJECT_ID = 'cuentopia-live-agent-mvp-6283';
// Firebase Storage REST API uses this bucket format usually
const BUCKET = 'cuentopia-live-agent-mvp-6283.firebasestorage.app';

const EMULATOR_HOST = process.env.FIREBASE_STORAGE_EMULATOR_HOST || 'localhost:9199';

const BASE_URL = USE_EMULATOR
  ? `http://${EMULATOR_HOST}/v0/b/${BUCKET}/o`
  : `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o`;

const images = [
  'dark.png',
  'school.png',
  'share.png',
  'sleep.png',
  'adventure.png'
];

async function uploadImages() {
  console.log(`Uploading images to ${USE_EMULATOR ? 'Emulator' : 'Production'} Storage...`);
  
  for (const img of images) {
    const filePath = path.join(__dirname, 'theme-images', img);
    if (!fs.existsSync(filePath)) {
      console.error(`❌ File not found: ${filePath}`);
      continue;
    }
    
    // Read file as Buffer
    const fileBuffer = fs.readFileSync(filePath);
    
    const objectName = `themes/${img}`;
    const url = `${BASE_URL}?name=${encodeURIComponent(objectName)}&uploadType=media`;
    
    // Add auth token or API key if necessary in production
    // For emulator, no auth is needed to upload if rules allow.
    // If rules deny, you might need a custom token.
    const headers = {
      'Content-Type': 'image/png',
      // 'Authorization': 'Bearer owner' // For emulator bypass
    };

    console.log(`Uploading ${img}...`);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: fileBuffer
      });
      
      const data = await res.json();
      if (!res.ok) {
        console.error(`❌ Failed to upload ${img}:`, data.error?.message || data);
      } else {
        const downloadUrl = USE_EMULATOR
          ? `http://${EMULATOR_HOST}/v0/b/${BUCKET}/o/${encodeURIComponent(objectName)}?alt=media`
          : `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(objectName)}?alt=media`;
        console.log(`✅ ${img} uploaded successfully!`);
        console.log(`   URL: ${downloadUrl}`);
      }
    } catch (e) {
      console.error(`❌ Fetch error for ${img}:`, e.message);
    }
  }
}

uploadImages().catch(console.error);
