const SPREADSHEET_ID = '1aZQlQdszET32S_pM8et-L_T0tA6CZ-4uFKPuCWz3Vxo';
const SHEET_NAME = 'assignments';

function doGet(e) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    const action = e.parameter.action;

    if (action === "saveAllChunk") {
      return saveAllChunk(e);
    } else if (action === "saveDayData") {
      const day = e.parameter.day;
      const data = JSON.parse(e.parameter.data);
      return saveDayData(day, data);
    } else if (action === 'debugSheets') {
      return debugSheets();
    } else if (action === 'initData') {
      return initializeData();
    } else if (action === 'getMembers') {
      return getMembers();
    } else if (action === 'getBrands') {
      return getBrands();
    } else if (action === 'getSchedule') {
      return getSchedule();
    }
    return ContentService.createTextOutput(JSON.stringify({error: 'Invalid action'})).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({success: false, error: error.toString()})).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

function doPost(e) {
  try {
    // Parse the JSON from the POST body (sent as text/plain to avoid CORS)
    const data = JSON.parse(e.postData.contents);
    const action = data.action;
    
    if (action === 'saveData') {
      if (data.data && data.data.assignments) {
        const currentData = getDataFromCell();
        currentData.assignments = data.data.assignments;
        saveDataToCell(currentData);
        return ContentService.createTextOutput(JSON.stringify({success: true})).setMimeType(ContentService.MimeType.JSON);
      }
    } else if (action === 'saveSchedule') {
      if (data.data) {
        saveCompleteData(data.data);
      } else {
        saveSchedule(data.assignments);
      }
      return ContentService.createTextOutput(JSON.stringify({success: true})).setMimeType(ContentService.MimeType.JSON);
    }
    return ContentService.createTextOutput(JSON.stringify({error: 'Invalid action'})).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    Logger.log('Error in doPost: ' + error.toString());
    return ContentService.createTextOutput(JSON.stringify({success: false, error: error.toString()})).setMimeType(ContentService.MimeType.JSON);
  }
}

// ============= HELPER: Get JSON from cell A1 =============
function getDataFromCell() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME);
    const cellValue = sheet.getRange('A1').getValue();
    
    if (!cellValue || cellValue === '') {
      Logger.log('⚠️ Cell A1 is empty');
      return { members: [], brands: {}, assignments: {} };
    }
    
    const parsed = JSON.parse(cellValue);
    Logger.log('✓ Data loaded from cell A1');
    
    // Backward compatibility: migrate 'schedule' to 'assignments' if needed
    if (parsed.schedule && !parsed.assignments) {
      parsed.assignments = parsed.schedule;
      Logger.log('⚠️ Migrated old data format from schedule to assignments');
    }
    
    return parsed;
  } catch (error) {
    Logger.log('❌ Error reading cell A1: ' + error);
    return { members: [], brands: {}, assignments: {} };
  }
}

// ============= HELPER: Save JSON to cell A1 =============
function saveDataToCell(data) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME);
    sheet.getRange('A1').setValue(JSON.stringify(data));
    SpreadsheetApp.flush();
    Logger.log('✓ Data saved to cell A1');
    return true;
  } catch (error) {
    Logger.log('❌ Error saving to cell A1: ' + error);
    return false;
  }
}

// ============= GET MEMBERS =============
function getMembers() {
  try {
    const data = getDataFromCell();
    const members = data.members || [];
    Logger.log('✓ Loaded ' + members.length + ' members');
    return ContentService.createTextOutput(JSON.stringify(members)).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    Logger.log('❌ Error in getMembers: ' + error);
    return ContentService.createTextOutput(JSON.stringify([])).setMimeType(ContentService.MimeType.JSON);
  }
}

// ============= GET BRANDS =============
function getBrands() {
  try {
    const data = getDataFromCell();
    const brands = data.brands || {};
    Logger.log('✓ Loaded ' + Object.keys(brands).length + ' brands');
    return ContentService.createTextOutput(JSON.stringify(brands)).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    Logger.log('❌ Error in getBrands: ' + error);
    return ContentService.createTextOutput(JSON.stringify({})).setMimeType(ContentService.MimeType.JSON);
  }
}

// ============= GET SCHEDULE =============
function getSchedule() {
  try {
    const data = getDataFromCell();
    const schedule = data.assignments || {};
    Logger.log('✓ Loaded schedule with ' + Object.keys(schedule).length + ' days');
    return ContentService.createTextOutput(JSON.stringify(schedule)).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    Logger.log('❌ Error in getSchedule: ' + error);
    return ContentService.createTextOutput(JSON.stringify({})).setMimeType(ContentService.MimeType.JSON);
  }
}

// ============= SAVE COMPLETE DATA =============
function saveCompleteData(completeData) {
  try {
    // Save complete structure: { members, brands, assignments }
    if (completeData && typeof completeData === 'object') {
      const dataToSave = {
        members: completeData.members || [],
        brands: completeData.brands || {},
        assignments: completeData.assignments || {}
      };
      saveDataToCell(dataToSave);
      Logger.log('✓ Saved complete data: ' + Object.keys(dataToSave.assignments).length + ' days');
      return true;
    }
    Logger.log('❌ Invalid data structure for saveCompleteData');
    return false;
  } catch (error) {
    Logger.log('❌ Error in saveCompleteData: ' + error);
    return false;
  }
}

// ============= SAVE SCHEDULE =============
function saveSchedule(newSchedule) {
  try {
    const data = getDataFromCell();
    data.assignments = newSchedule;
    saveDataToCell(data);
    Logger.log('✓ Saved schedule with ' + Object.keys(newSchedule).length + ' days');
    return true;
  } catch (error) {
    Logger.log('❌ Error in saveSchedule: ' + error);
    return false;
  }
}

// ============= DEBUG: Show all sheet info =============
function debugSheets() {
  try {
    const data = getDataFromCell();
    
    const debugInfo = {
      spreadsheet: 'AppTiming',
      sheet: SHEET_NAME,
      dataLocation: 'Cell A1 contains complete JSON',
      members: {
        count: data.members ? data.members.length : 0,
        list: data.members ? data.members.slice(0, 5) : []
      },
      brands: {
        count: data.brands ? Object.keys(data.brands).length : 0,
        list: data.brands ? Object.keys(data.brands).slice(0, 5) : []
      },
      schedule: {
        days: data.assignments ? Object.keys(data.assignments).length : 0,
        firstDate: data.assignments ? Object.keys(data.assignments)[0] : null,
        lastDate: data.assignments ? Object.keys(data.assignments)[Object.keys(data.assignments).length - 1] : null
      }
    };
    
    Logger.log('🔍 DEBUG: ' + JSON.stringify(debugInfo, null, 2));
    return ContentService.createTextOutput(JSON.stringify(debugInfo)).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    Logger.log('❌ Error in debugSheets: ' + error);
    return ContentService.createTextOutput(JSON.stringify({error: error.toString()})).setMimeType(ContentService.MimeType.JSON);
  }
}

// ============= INITIALIZE DATA =============
function initializeData() {
  try {
    const initialData = {
      members: ["Open Seat"],
      brands: {},
      assignments: {}
    };
    
    saveDataToCell(initialData);
    Logger.log('✓ Data initialized in cell A1');
    return ContentService.createTextOutput(JSON.stringify({success: true, message: 'Data initialized'})).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    Logger.log('❌ Error initializing data: ' + error);
    return ContentService.createTextOutput(JSON.stringify({error: error.toString()})).setMimeType(ContentService.MimeType.JSON);
  }
}

// ============= SAVE ALL CHUNK (chunked GET-based save) =============
function saveAllChunk(e) {
  const chunk  = parseInt(e.parameter.chunk)  || 0;
  const total  = parseInt(e.parameter.total)  || 1;
  const data   = e.parameter.data   || '';
  const batch  = e.parameter.batch  || 'default';

  const lock = LockService.getScriptLock();
  try { lock.waitLock(30000); }
  catch(err) {
    return ContentService.createTextOutput(JSON.stringify({success:false, error:'Lock timeout'}))
      .setMimeType(ContentService.MimeType.JSON);
  }

  try {
    const props = PropertiesService.getScriptProperties();
    props.setProperty('sb_' + batch + '_' + chunk, data);

    if (chunk === total - 1) {
      let assembled = '';
      for (let i = 0; i < total; i++) {
        assembled += props.getProperty('sb_' + batch + '_' + i) || '';
      }
      for (let i = 0; i < total; i++) {
        props.deleteProperty('sb_' + batch + '_' + i);
      }

      const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
      const sheet = ss.getSheetByName(SHEET_NAME);
      sheet.getRange('A1').setValue(assembled);
      SpreadsheetApp.flush();

      return ContentService.createTextOutput(JSON.stringify({success:true, saved:true, length:assembled.length}))
        .setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({success:true, saved:false, chunk:chunk}))
      .setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({success:false, error:err.toString()}))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

// ============= SAVE DAY DATA =============
function saveDayData(day, data) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME);
    const cell = sheet.getRange("A1");
    let fullData = {};
    if (cell.getValue()) {
      try { fullData = JSON.parse(cell.getValue()); } catch (e) { fullData = {}; }
    }
    if (!fullData.assignments) fullData.assignments = {};
    fullData.assignments[day] = data;
    cell.setValue(JSON.stringify(fullData));
    SpreadsheetApp.flush();
    return ContentService.createTextOutput(JSON.stringify({success: true})).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({success: false, error: error.toString()})).setMimeType(ContentService.MimeType.JSON);
  }
}
