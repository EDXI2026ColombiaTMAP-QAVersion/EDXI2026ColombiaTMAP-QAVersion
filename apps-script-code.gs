const SPREADSHEET_ID = '1aZQlQdszET32S_pM8et-L_T0tA6CZ-4uFKPuCWz3Vxo';
const SHEET_NAME = 'assignments';

function doPost(e) {
  Logger.log("🔵 [doPost] Called");
  const lock = LockService.getDocumentLock();
  try {
    lock.waitLock(30000);
  } catch(lockErr) {
    Logger.log("❌ [doPost] Document lock timeout: " + lockErr.toString());
    return ContentService.createTextOutput(JSON.stringify({success:false, error:'Lock timeout'}))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  try {
    const action = e.parameter.action;
    Logger.log("🔶 [doPost] action=" + (action || "NONE"));
    let data = null;
    
    if (action === "saveAll") {
      Logger.log("🔶 [doPost] Handling saveAll");
      if (e.postData && e.postData.contents) {
        Logger.log("🔶 [doPost] Parsing postData.contents");
        const parsed = JSON.parse(e.postData.contents);
        data = parsed.data || parsed;
      } else if (e.parameter.data) {
        Logger.log("🔶 [doPost] Parsing parameter.data");
        data = JSON.parse(e.parameter.data);
      }
      
      if (data) {
        Logger.log("🔶 [doPost] Data parsed, calling saveToSheet");
        return saveToSheet(data);
      } else {
        Logger.log("❌ [doPost] No data extracted");
      }
    }
    
    Logger.log("⚠️ [doPost] Unknown or missing action");
    return ContentService.createTextOutput(JSON.stringify({error: "Invalid action"})).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    Logger.log("❌ [doPost] error: " + error.toString());
    return ContentService.createTextOutput(JSON.stringify({success: false, error: error.toString()})).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
    Logger.log("🔵 [doPost] Lock released");
  }
}

function doGet(e) {
  Logger.log("🔵 [doGet] Called with action=" + (e.parameter.action || "NONE"));
  const lock = LockService.getDocumentLock();
  try {
    lock.waitLock(30000);
  } catch(lockErr) {
    Logger.log("❌ [doGet] Document lock timeout: " + lockErr.toString());
    return ContentService.createTextOutput(JSON.stringify({success:false, error:'Lock timeout'}))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  try {
    const action = e.parameter.action;
    
    if (action === "saveAllChunk") {
      Logger.log("🔶 [doGet] Routing to saveAllChunk");
      return saveAllChunk(e);
    } else if (action === "saveDayData") {
      Logger.log("🔶 [doGet] Routing to saveDayData");
      const day = e.parameter.day;
      const data = JSON.parse(e.parameter.data);
      return saveDayData(day, data);
    }
    
    Logger.log("⚠️ [doGet] Unknown action: " + action);
    return ContentService.createTextOutput(JSON.stringify({error: "Invalid action"})).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    Logger.log("❌ [doGet] error: " + error.toString());
    return ContentService.createTextOutput(JSON.stringify({success: false, error: error.toString()})).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
    Logger.log("🔵 [doGet] Lock released");
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

  Logger.log("📥 [saveAllChunk] chunk=" + chunk + "/" + total + ", batch=" + batch + ", dataLen=" + data.length);

  const lock = LockService.getScriptLock();
  try { 
    lock.waitLock(30000);
    Logger.log("✅ [saveAllChunk] Script lock acquired");
  } 
  catch(err) {
    Logger.log("❌ [saveAllChunk] Script lock timeout: " + err.toString());
    return ContentService.createTextOutput(JSON.stringify({success:false, error:'Lock timeout'}))
      .setMimeType(ContentService.MimeType.JSON);
  }

  try {
    const props = PropertiesService.getScriptProperties();

    // Store this chunk under a batch-specific key
    props.setProperty('sb_' + batch + '_' + chunk, data);
    Logger.log("💾 [saveAllChunk] Stored chunk " + chunk + " to PropertiesService");

    if (chunk === total - 1) {
      Logger.log("🔗 [saveAllChunk] Final chunk received. Assembling " + total + " chunks...");
      
      // Final chunk — assemble only this batch's chunks
      let assembled = '';
      const missingChunks = [];
      for (let i = 0; i < total; i++) {
        const chunkData = props.getProperty('sb_' + batch + '_' + i);
        if (!chunkData) {
          missingChunks.push(i);
          Logger.log("⚠️ [saveAllChunk] Missing chunk " + i);
        }
        assembled += chunkData || '';
      }
      
      if (missingChunks.length > 0) {
        Logger.log("❌ [saveAllChunk] Cannot assemble: missing chunks [" + missingChunks.join(',') + "]");
        return ContentService.createTextOutput(JSON.stringify({success:false, error:'Missing chunks: ' + missingChunks.join(',')}))
          .setMimeType(ContentService.MimeType.JSON);
      }
      
      Logger.log("✅ [saveAllChunk] All chunks assembled: " + assembled.length + " chars");
      
      // Clean up this batch
      for (let i = 0; i < total; i++) {
        props.deleteProperty('sb_' + batch + '_' + i);
      }
      // Clean up any old default-key chunks from previous versions
      for (let i = 0; i < 20; i++) {
        props.deleteProperty('chunk_' + i);
      }

      // Validate JSON before writing
      try {
        JSON.parse(assembled);
        Logger.log("✅ [saveAllChunk] JSON is valid");
      } catch(jsonErr) {
        Logger.log("❌ [saveAllChunk] JSON invalid: " + jsonErr.toString() + ". First 200 chars: " + assembled.substring(0,200));
        return ContentService.createTextOutput(JSON.stringify({success:false, error:'Invalid JSON: ' + jsonErr.toString()}))
          .setMimeType(ContentService.MimeType.JSON);
      }

      // Save assembled JSON to Sheet
      try {
        const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
        Logger.log("✅ [saveAllChunk] Spreadsheet opened");
        
        const sheet = ss.getSheetByName(SHEET_NAME);
        Logger.log("✅ [saveAllChunk] Sheet '" + SHEET_NAME + "' found");
        
        const range = sheet.getRange('A1');
        Logger.log("✅ [saveAllChunk] Range A1 acquired");
        
        range.setValue(assembled);
        Logger.log("✅ [saveAllChunk] setValue() completed");
        
        SpreadsheetApp.flush();
        Logger.log("✅ [saveAllChunk] SpreadsheetApp.flush() completed");
        
        // Verify write by reading back
        const written = range.getValue();
        const widMatch = written.includes('"_wid"') ? 'YES' : 'NO';
        Logger.log("✅ [saveAllChunk batch=" + batch + "] Successfully wrote " + assembled.length + " chars to A1. Contains _wid: " + widMatch);

        return ContentService.createTextOutput(JSON.stringify({success:true, saved:true, length:assembled.length}))
          .setMimeType(ContentService.MimeType.JSON);
      } catch(sheetErr) {
        Logger.log("❌ [saveAllChunk] Sheet write error: " + sheetErr.toString());
        return ContentService.createTextOutput(JSON.stringify({success:false, error:'Sheet error: ' + sheetErr.toString()}))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }

    Logger.log("📥 [saveAllChunk] Chunk " + chunk + " stored. Waiting for chunks " + (chunk+1) + " to " + (total-1));
    return ContentService.createTextOutput(JSON.stringify({success:true, saved:false, chunk:chunk}))
      .setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    Logger.log("❌ [saveAllChunk] Unexpected error: " + err.toString());
    return ContentService.createTextOutput(JSON.stringify({success:false, error:err.toString()}))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
    Logger.log("✅ [saveAllChunk] Script lock released");
  }
}

// ============= SAVE TO SHEET (doPost handler for saveAll action) =============
function saveToSheet(data) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME);
    sheet.getRange('A1').setValue(JSON.stringify(data));
    SpreadsheetApp.flush();
    Logger.log('✅ [saveToSheet] Written ' + JSON.stringify(data).length + ' chars to A1 via doPost');
    return ContentService.createTextOutput(JSON.stringify({success: true, saved: true}))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    Logger.log('❌ [saveToSheet] Error: ' + error.toString());
    return ContentService.createTextOutput(JSON.stringify({success: false, error: error.toString()}))
      .setMimeType(ContentService.MimeType.JSON);
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
