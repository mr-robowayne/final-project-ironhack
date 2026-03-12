'use strict';

const puppeteer = require('puppeteer');

const PUPPETEER_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-networking',
  '--disable-extensions',
  '--disable-features=TranslateUI,site-per-process',
  '--disable-component-update',
  '--disable-sync',
  '--metrics-recording-only',
  '--mute-audio',
  '--remote-debugging-port=0'
];

const launchBrowser = async () => {
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;
  return puppeteer.launch({
    headless: 'new',
    args: PUPPETEER_ARGS,
    executablePath,
    defaultViewport: { width: 1280, height: 900, deviceScaleFactor: 1 },
    userDataDir: '/tmp/puppeteer'
  });
};

module.exports = {
  launchBrowser,
  PUPPETEER_ARGS
};
