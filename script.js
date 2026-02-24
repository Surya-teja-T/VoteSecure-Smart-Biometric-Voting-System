// script.js - client-side logic for the demo prototype

// --------- Utilities: Web Crypto helpers ----------
async function sha256Hex(buffer) {
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  const hex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2,'0')).join('');
  return hex;
}
async function stringToArrayBuffer(str){ return new TextEncoder().encode(str); }
async function arrayBufferFromDataUrl(dataUrl){
  const res = await fetch(dataUrl);
  return await res.arrayBuffer();
}

// AES-GCM demo: derive key from a demo passphrase (NOT secure for production)
const DEMO_KEY_PASSPHRASE = 'demo-secret-key-for-academic-demo-please-change';
async function getAesKey(){
  const pwBuf = await stringToArrayBuffer(DEMO_KEY_PASSPHRASE);
  const baseKey = await crypto.subtle.importKey('raw', pwBuf, 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {name:'PBKDF2', salt: new Uint8Array([1,2,3,4,5,6,7,8]), iterations:100000, hash:'SHA-256'},
    baseKey,
    {name:'AES-GCM', length:256},
    false,
    ['encrypt','decrypt']
  );
}
async function aesEncryptJson(obj){
  const key = await getAesKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = JSON.stringify(obj);
  const enc = await crypto.subtle.encrypt({name:'AES-GCM', iv}, key, new TextEncoder().encode(plain));
  return { iv: Array.from(iv), data: Array.from(new Uint8Array(enc)) };
}
async function aesDecryptToJson(encObj){
  const key = await getAesKey();
  const iv = new Uint8Array(encObj.iv);
  const data = new Uint8Array(encObj.data).buffer;
  const dec = await crypto.subtle.decrypt({name:'AES-GCM', iv}, key, data);
  return JSON.parse(new TextDecoder().decode(dec));
}

// --------- Local storage helpers ----------
const STORAGE_VOTES_KEY = 'sbv_votes_v1'; // stores array of {id, encrypted, block}
function loadVotes(){ try { return JSON.parse(localStorage.getItem(STORAGE_VOTES_KEY) || '[]'); } catch(e){ return []; } }
function saveVotes(arr){ localStorage.setItem(STORAGE_VOTES_KEY, JSON.stringify(arr)); }

// Simple hash-chain block creator
async function createBlock(prevHash, dataHash){
  const timestamp = Date.now();
  const nonce = Math.floor(Math.random()*1e9);
  const payload = ${prevHash}|${timestamp}|${nonce}|${dataHash};
  const hash = await sha256Hex(new TextEncoder().encode(payload));
  return { prevHash, timestamp, nonce, dataHash, hash };
}

// --------- Flow step helpers used by pages ----------

/* Aadhaar verify (simulated): requires 12-digit and OTP == 123456 */
function verifyAadhaarClient(aadhaar, otp){
  if(!/^\d{12}$/.test(aadhaar)) return { ok:false, msg:'Aadhaar must be 12 digits' };
  if(otp !== '123456') return { ok:false, msg:'Invalid demo OTP (use 123456)' };
  return { ok:true };
}

/* Save intermediate state in localStorage during flow */
function setFlowState(obj){
  const state = JSON.parse(localStorage.getItem('sbv_flow')||'{}');
  const merged = {...state, ...obj};
  localStorage.setItem('sbv_flow', JSON.stringify(merged));
}
function getFlowState(){ return JSON.parse(localStorage.getItem('sbv_flow')||'{}'); }
function clearFlowState(){ localStorage.removeItem('sbv_flow'); }

// --------- Page-specific behaviors (run on DOM load) ----------
document.addEventListener('DOMContentLoaded', () => {
  // Index / Aadhaar page
  const aadhaarForm = document.getElementById('aadhaarForm');
  if(aadhaarForm){
    aadhaarForm.addEventListener('submit', (e)=>{
      e.preventDefault();
      const aad = document.getElementById('aadhaar').value.trim();
      const otp = document.getElementById('otp').value.trim();
      const res = verifyAadhaarClient(aad, otp);
      const status = document.getElementById('aadhaarStatus');
      if(!res.ok){ status.innerText = res.msg; status.classList.add('status'); return; }
      // store aadhaar and go to face
      setFlowState({ aadhaar });
      window.location.href = 'face.html';
    });
  }

  // Face page
  const initFace = document.getElementById('initFace');
  if(initFace){
    const video = document.getElementById('video');
    const canvas = document.getElementById('faceCanvas');
    const status = document.getElementById('faceStatus');
    // start camera
    navigator.mediaDevices.getUserMedia({ video:true }).then(stream => { video.srcObject = stream; video.play(); })
      .catch(()=> { status.innerText = 'Webcam not available. You may proceed with demo capture.'});
    document.getElementById('captureFaceBtn').addEventListener('click', async ()=>{
      canvas.width = video.videoWidth || 320; canvas.height = video.videoHeight || 240;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video,0,0,canvas.width,canvas.height);
      const dataUrl = canvas.toDataURL('image/png');
      // store faceData
      setFlowState({ faceDataUrl: dataUrl });
      status.innerText = 'Face captured (demo). Proceed to fingerprint.';
      setTimeout(()=> window.location.href = 'fingerprint.html', 900);
    });
  }

  // Fingerprint page
  const fpForm = document.getElementById('fpForm');
  if(fpForm){
    const status = document.getElementById('fpStatus');
    const fpInput = document.getElementById('fpfile');
    fpForm.addEventListener('submit', async (e)=>{
      e.preventDefault();
      const file = fpInput.files && fpInput.files[0];
      let dataUrl;
      if(file){
        dataUrl = await new Promise(res => {
          const r = new FileReader();
          r.onload = ()=> res(r.result);
          r.readAsDataURL(file);
        });
      } else {
        // fallback: use demo string
        dataUrl = 'demo-fingerprint-data';
      }
      const buf = await arrayBufferFromDataUrl(dataUrl);
      const fpHash = await sha256Hex(buf);
      setFlowState({ fingerprintHash: fpHash });
      status.innerText = 'Fingerprint processed (demo). Proceeding to vote page...';
      setTimeout(()=> window.location.href = 'vote.html', 800);
    });
  }

  // Vote page
  const voteForm = document.getElementById('voteForm');
  if(voteForm){
    voteForm.addEventListener('submit', async (e)=>{
      e.preventDefault();
      const cand = document.getElementById('candidate').value;
      const state = getFlowState();
      if(!state.aadhaar || !state.fingerprintHash || !state.faceDataUrl){
        alert('You must complete Aadhaar, face capture and fingerprint steps (demo).'); return;
      }
      // Build payload
      const payload = {
        aadhaar: state.aadhaar,
        candidate: cand,
        fingerprintHash: state.fingerprintHash,
        faceDataUrl: state.faceDataUrl,
        ts: Date.now()
      };
      // compute dataHash (hash of payload)
      const dataHash = await sha256Hex(new TextEncoder().encode(JSON.stringify(payload)));
      // encrypt payload (client-side demo)
      const encrypted = await aesEncryptJson(payload);
      // Create ledger block using previous hash
      const votes = loadVotes();
      const prevHash = votes.length ? votes[votes.length-1].block.hash : 'GENESIS';
      const block = await createBlock(prevHash, dataHash);
      const id = 'vote-' + Date.now();
      votes.push({ id, encrypted, block });
      saveVotes(votes);
      clearFlowState();
      // go to confirmation and show id
      sessionStorage.setItem('lastVoteId', id);
      window.location.href = 'confirmation.html';
    });
  }

  // Confirmation page: show last vote id
  const lastIdEl = document.getElementById('lastVoteId');
  if(lastIdEl){
    lastIdEl.innerText = sessionStorage.getItem('lastVoteId') || 'N/A';
  }

  // Admin page: show stats and verify ledger integrity
  const adminLoad = document.getElementById('adminLoad');
  if(adminLoad){
    const outTotal = document.getElementById('totalVotes');
    const ledgerEl = document.getElementById('ledgerPre');
    const votes = loadVotes();
    outTotal.innerText = votes.length;
    ledgerEl.innerText = JSON.stringify(votes.map(v=>v.block).slice(-20).reverse(), null, 2);
  }

  // Admin verify button
  const verifyBtn = document.getElementById('verifyLedgerBtn');
  if(verifyBtn){
    verifyBtn.addEventListener('click', async ()=>{
      const votes = loadVotes();
      let ok=true; let msg='Ledger OK';
      for(let i=0;i<votes.length;i++){
        const prev = i===0 ? 'GENESIS' : votes[i-1].block.hash;
        if(votes[i].block.prevHash !== prev){ ok=false; msg = Mismatch at index ${i}; break; }
      }
      alert(msg);
    });
  }
});