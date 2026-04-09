# Render Deployment Instructions

## Setup Steps:

1. Push this code to GitHub (already done)

2. Go to https://render.com and sign up with GitHub

3. Create New Web Service:
   - Connect to EdelmanDXIHub/EdelmanDXIHub.github.io repository
   - Name: `apptiming-sync`
   - Runtime: Node
   - Build command: `npm install`
   - Start command: `npm start`
   - Plan: Free

4. Set Environment Variables in Render:
   - Go to Service settings → Environment
   - Add: `REPO_PATH=/opt/render/project/src`

5. Configure Git Credentials (IMPORTANT):
   - Render needs git credentials to push changes
   - Option A: Create Personal Access Token on GitHub
     - Go to Settings → Developer settings → Personal access tokens
     - Create token with `repo` scope
   - Add to Render Environment Variables:
     - `GIT_USER=your-github-username`
     - `GIT_PASS=your-github-token`

6. Update server.js to use credentials:
   - Set git config before push operations

## API Endpoints:

- POST `/api/sync` - Save changes and push to GitHub
  - Body: `{ "data": { members, brands, schedule... } }`

- POST `/api/pull` - Pull latest from GitHub
  - Call this when page loads

## Connect from app.js:

Replace localStorage with API calls:

```javascript
const API_URL = 'https://apptiming-sync.onrender.com';

// When saving state:
async function syncToServer(state) {
  try {
    const response = await fetch(`${API_URL}/api/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: state })
    });
    return await response.json();
  } catch (error) {
    console.error('Sync failed:', error);
  }
}

// When loading page:
async function pullFromServer() {
  try {
    await fetch(`${API_URL}/api/pull`, { method: 'POST' });
    location.reload(); // Reload to get fresh data
  } catch (error) {
    console.error('Pull failed:', error);
  }
}
```
