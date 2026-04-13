// Google Apps Script endpoint
const GOOGLE_SHEETS_API = 'https://script.google.com/macros/s/AKfycbw0QNuUPQUKHx_r1LsYbKeRPMzsvsFbBFVMdOIXETd8WLwkB8G3oc_Yo3zm9zSgtVHctA/exec';

// Load COMPLETE data from Google Sheets - members, brands, and schedule
async function loadCompleteDataFromSheets(retries = 3) {
  let lastError;
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`Loading complete data from Google Sheets (attempt ${attempt}/${retries})...`);
      
      const timestamp = Date.now();
      
      // Load all data in parallel
      const [membersResp, brandsResp, scheduleResp] = await Promise.all([
        fetch(`${GOOGLE_SHEETS_API}?action=getMembers&t=${timestamp}`, { cache: 'no-store' }),
        fetch(`${GOOGLE_SHEETS_API}?action=getBrands&t=${timestamp}`, { cache: 'no-store' }),
        fetch(`${GOOGLE_SHEETS_API}?action=getSchedule&t=${timestamp}`, { cache: 'no-store' })
      ]);
      
      if (!membersResp.ok || !brandsResp.ok || !scheduleResp.ok) {
        throw new Error(`HTTP error - members: ${membersResp.status}, brands: ${brandsResp.status}, schedule: ${scheduleResp.status}`);
      }
      
      const [membersData, brandsData, scheduleData] = await Promise.all([
        membersResp.json(),
        brandsResp.json(),
        scheduleResp.json()
      ]);
      
      console.log('✓ Complete data loaded from Google Sheets');
      console.log('  Members:', Array.isArray(membersData) ? membersData.length : 0);
      console.log('  Brands:', Array.isArray(brandsData) ? brandsData.length : 0);
      console.log('  Schedule days:', scheduleData ? Object.keys(scheduleData).length : 0);
      
      return {
        members: membersData,
        brands: brandsData,
        schedule: scheduleData || {}
      };
    } catch (error) {
      lastError = error;
      console.error(`Attempt ${attempt} failed:`, error);
      
      if (attempt < retries) {
        const waitTime = Math.pow(2, attempt - 1) * 500;
        console.log(`Retrying in ${waitTime}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }
  
  console.error('Failed to load complete data after all retries:', lastError);
  return null;
}

// Fetch members from Google Sheets
async function fetchMembers() {
  try {
    console.log('Fetching members from Google Sheets...');
    const response = await fetch(`${GOOGLE_SHEETS_API}?action=getMembers`);
    console.log('Response status:', response.status);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    console.log('Members data received:', data);
    
    if (Array.isArray(data)) {
      const members = data
        .map(row => {
          console.log('Processing row:', row);
          return row['NAME_TEAM_MEMBERS'] || row['Name'] || row['name'] || '';
        })
        .filter(name => name && name.trim());
      
      console.log('Final members:', members);
      return members;
    }
    return [];
  } catch (error) {
    console.error('Error fetching members:', error);
    return [];
  }
}

// Fetch brands from Google Sheets
async function fetchBrands() {
  try {
    console.log('Fetching brands from Google Sheets...');
    const response = await fetch(`${GOOGLE_SHEETS_API}?action=getBrands`);
    console.log('Response status:', response.status);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    console.log('Brands data received:', data);
    
    if (Array.isArray(data)) {
      const brands = data
        .map(row => {
          console.log('Processing brand row:', row);
          return {
            id: row['ID_BRANDS'] || row['BrandId'] || row['id'] || '',
            name: row['BransName_BRAN...'] || row['BrandName'] || row['name'] || '',
            color: row['Color_BRANDS'] || row['Color'] || row['color'] || '#000000',
            order: row['ORDER_BRANDS'] || row['Order'] || row['order'] || 0
          };
        })
        .filter(b => b.id && b.name);
      
      console.log('Final brands:', brands);
      return brands;
    }
    return [];
  } catch (error) {
    console.error('Error fetching brands:', error);
    return [];
  }
}

// Add member to Google Sheets
async function addMemberToSheets(name) {
  try {
    console.log('Adding member:', name);
    const response = await fetch(GOOGLE_SHEETS_API, {
      method: 'POST',
      body: JSON.stringify({
        action: 'addMember',
        name: name
      })
    });
    const result = await response.json();
    console.log('Add member result:', result);
    return result.success || false;
  } catch (error) {
    console.error('Error adding member:', error);
    return false;
  }
}

// Add brand to Google Sheets
async function addBrandToSheets(id, name, color, order) {
  try {
    console.log('Adding brand:', id, name, color, order);
    const response = await fetch(GOOGLE_SHEETS_API, {
      method: 'POST',
      body: JSON.stringify({
        action: 'addBrand',
        id: id,
        name: name,
        color: color,
        order: order
      })
    });
    const result = await response.json();
    console.log('Add brand result:', result);
    return result.success || false;
  } catch (error) {
    console.error('Error adding brand:', error);
    return false;
  }
}

// Save schedule changes to Google Sheets
async function saveScheduleToSheets(scheduleData) {
  try {
    console.log('Saving schedule to Google Sheets...');
    const response = await fetch(GOOGLE_SHEETS_API, {
      method: 'POST',
      body: JSON.stringify({
        action: 'saveSchedule',
        assignments: scheduleData
      })
    });
    const result = await response.json();
    console.log('Schedule saved result:', result);
    return result.success || false;
  } catch (error) {
    console.error('Error saving schedule:', error);
    return false;
  }
}

// Load schedule from Google Sheets with retry logic
async function loadScheduleFromSheets(retries = 3) {
  let lastError;
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`Loading schedule from Google Sheets (attempt ${attempt}/${retries})...`);
      
      // Add cache busting to always get fresh data
      const timestamp = Date.now();
      const response = await fetch(`${GOOGLE_SHEETS_API}?action=getSchedule&t=${timestamp}`, {
        cache: 'no-store'
      });
      
      console.log('Schedule response status:', response.status);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      console.log('Schedule data received:', data);
      
      // Check if we got valid data
      if (data && typeof data === 'object') {
        // Even if empty, that's valid from Google Sheets
        console.log('Schedule loaded from Google Sheets, keys:', Object.keys(data).length);
        return data;
      }
      
      throw new Error('Invalid data received');
    } catch (error) {
      lastError = error;
      console.error(`Attempt ${attempt} failed:`, error);
      
      // Wait before retrying (exponential backoff)
      if (attempt < retries) {
        const waitTime = Math.pow(2, attempt - 1) * 500; // 500ms, 1s, 2s
        console.log(`Retrying in ${waitTime}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }
  
  console.error('Failed to load schedule after all retries:', lastError);
  return null;
}
