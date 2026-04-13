// Proxy CORS para Google Apps Script
// Desplegado en Vercel

const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbz0OP__V0k599b2bEoAsdzWFANMpatkVopl0hyrzRQIsxcCsixVyDGGVvK4XTooj80Wcw/exec';

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    // Handle saveData action (for sheet sync)
    if (req.method === 'POST' && req.body?.action === 'saveData') {
      const jsonData = req.body.data; // This is the stringified JSON
      
      // Forward to Apps Script via GET (to avoid CORS preflight on Apps Script side)
      const url = WEB_APP_URL + "?action=saveData&data=" + encodeURIComponent(jsonData);
      
      console.log(`[proxy] Forwarding saveData to Apps Script, data length: ${jsonData?.length}`);
      
      const response = await fetch(url, { method: "GET" });
      const data = await response.json();
      
      res.status(200).json({
        success: data.success || false,
        message: data.message,
        length: data.length
      });
      return;
    }
    
    // Original GET/POST handlers
    if (req.method === 'GET') {
      const action = req.query.action || 'getData';
      
      const response = await fetch(`${WEB_APP_URL}?action=${action}`);
      const data = await response.json();
      
      res.status(200).json({
        success: true,
        data: data
      });
    } 
    else if (req.method === 'POST') {
      const response = await fetch(WEB_APP_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(req.body)
      });
      
      const data = await response.json();
      res.status(200).json(data);
    }
    else {
      res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Proxy error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
