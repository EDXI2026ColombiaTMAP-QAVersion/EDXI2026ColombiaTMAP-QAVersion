// Proxy CORS para Google Apps Script
// Desplegado en Vercel

const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbwyLokmKCwvVbolf98h25Onr9Qbmw1np6ujZ4GoutgDys4m0EAyS-90D5F7Y3jRZF4BXw/exec';

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
