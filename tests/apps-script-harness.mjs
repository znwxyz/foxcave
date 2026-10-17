import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';

// Deliberately no Google credentials or network access: these are local service doubles.
class Range {
  constructor(sheet, row, column, height = 1, width = 1) { Object.assign(this, { sheet, row, column, height, width }); }
  getValues() {
    return Array.from({ length: this.height }, (_, i) => Array.from({ length: this.width }, (_, j) => this.sheet.data[this.row - 1 + i]?.[this.column - 1 + j] ?? ''));
  }
  getDisplayValues() { return this.getValues().map((row) => row.map((value) => typeof value === 'boolean' ? String(value).toUpperCase() : String(value))); }
  setValues(values) {
    if (values.length !== this.height || values.some((row) => row.length !== this.width)) throw new Error('Invalid range dimensions');
    if (this.sheet.failWrites) throw new Error('Spreadsheet write failed');
    for (let i = 0; i < this.height; i++) {
      const row = this.sheet.data[this.row - 1 + i] ||= [];
      for (let j = 0; j < this.width; j++) {
        let value = values[i][j];
        if (typeof value === 'string' && value.startsWith("'")) value = value.slice(1);
        row[this.column - 1 + j] = value;
      }
    }
    return this;
  }
  setNumberFormat() { return this; }
  setDataValidation() { return this; }
  setNote() { return this; }
  setFontWeight() { return this; }
  setBackground() { return this; }
}
class Sheet {
  constructor(name, id) { this.name = name; this.id = id; this.data = []; this.maxRows = 1000; }
  getLastRow() { return this.data.length; }
  getMaxRows() { return this.maxRows; }
  insertRowsAfter(_, count) { this.maxRows += count; }
  getSheetId() { return this.id; }
  setFrozenRows() {}
  getRange(row, column, height, width) {
    if (typeof row === 'string') {
      const match = row.match(/^([A-Z]+)(\d*)/);
      return new Range(this, Number(match[2] || 1), [...match[1]].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0));
    }
    if (row + (height || 1) - 1 > this.maxRows) throw new Error('Range beyond sheet grid');
    return new Range(this, row, column, height, width);
  }
}
class Book {
  constructor() { this.sheets = new Map(); }
  getId() { return 'test-private-sheet'; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/test-private-sheet/edit'; }
  setSpreadsheetTimeZone() {}
  getSheetByName(name) { return this.sheets.get(name); }
  insertSheet(name) { const sheet = new Sheet(name, this.sheets.size + 1); this.sheets.set(name, sheet); return sheet; }
}

export function createHarness({ now = '2026-10-17T03:00:00Z' } = {}) {
  const env = { now: Date.parse(now), mail: [], quota: 100, mailFails: false, lockBusy: false, locked: false, properties: {}, triggers: [], book: new Book(), creates: 0 };
  const properties = {
    getProperty: (key) => env.properties[key] ?? null,
    setProperty: (key, value) => { env.properties[key] = String(value); return properties; },
  };
  const rule = { requireValueInList() { return this; }, setAllowInvalid() { return this; }, requireCheckbox() { return this; }, build() { return {}; } };
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [env.now])); }
    static now() { return env.now; }
  }
  const context = vm.createContext({
    console: { log() {}, error() {} }, Date: ClockDate,
    PropertiesService: { getScriptProperties: () => properties },
    SpreadsheetApp: {
      create: () => { env.creates++; return env.book; },
      openById: (id) => { if (id !== env.book.getId()) throw new Error('Unknown spreadsheet'); return env.book; },
      newDataValidation: () => rule,
      flush: () => { if (env.flushFails) throw new Error('Flush failed'); },
    },
    ScriptApp: {
      getProjectTriggers: () => env.triggers.map((name) => ({ getHandlerFunction: () => name })),
      newTrigger: (name) => ({ timeBased() { return this; }, everyMinutes() { return this; }, create() { env.triggers.push(name); } }),
    },
    MailApp: {
      getRemainingDailyQuota: () => env.quota,
      sendEmail: (message) => {
        const recipientCount = message.to.split(',').length;
        if (env.mailFails || env.quota < recipientCount) throw new Error('Mail unavailable');
        env.mail.push(structuredClone(message)); env.quota -= recipientCount;
        if (env.afterSend) env.afterSend();
      },
    },
    LockService: { getScriptLock: () => ({
      tryLock: () => { if (env.lockBusy || env.locked) return false; env.locked = true; return true; },
      releaseLock: () => { env.locked = false; },
    }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' }, Charset: { UTF_8: 'UTF_8' },
      computeDigest: (_, text) => [...createHash('sha256').update(text).digest()],
      formatDate: (date, timezone, format) => {
        if (timezone !== 'Asia/Seoul') throw new Error('Unexpected timezone');
        const iso = new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString();
        const fields = { yyyy: iso.slice(0, 4), MM: iso.slice(5, 7), dd: iso.slice(8, 10), HH: iso.slice(11, 13), mm: iso.slice(14, 16), ss: iso.slice(17, 19) };
        return format.replace(/yyyy|MM|dd|HH|mm|ss/g, (token) => fields[token]);
      },
    },
    ContentService: { MimeType: { JSON: 'application/json' }, createTextOutput: (body) => ({ body, setMimeType() { return this; } }) },
  });
  vm.runInContext(readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8'), context);
  env.run = (name, ...args) => context[name](...args);
  env.get = (params) => JSON.parse(context.doGet({ parameter: params }).body);
  env.post = (input) => JSON.parse(context.doPost({ postData: { contents: JSON.stringify(input) } }).body);
  env.setup = () => context.setup();
  env.requests = () => env.book.getSheetByName('예약 신청').data.slice(1);
  env.addSlot = (date = '2026-10-20', time = '19:30', maxParty = 2, isOpen = true) => {
    env.book.getSheetByName('수업 일정').data.push([date, time, 90, maxParty, isOpen]);
    return date + 'T' + time + ':00+09:00';
  };
  return env;
}

export function booking(overrides = {}) {
  return { version: 1, action: 'submit', requestId: randomUUID(), origin: 'http://127.0.0.1:4173', kind: 'class', slotId: '2026-10-20T19:30:00+09:00', party: 2, name: '테스트 신청', phone: '010-0000-0000', channel: 'search', message: '로컬 검증용 가상 데이터', consent: true, website: '', ...overrides };
}
