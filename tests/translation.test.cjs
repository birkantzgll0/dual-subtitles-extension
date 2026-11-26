const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');

test('translation requests require the disclosed opt-in even for existing installs', async () => {
  const listeners = [];
  const stored = {translationEnabled:true};
  const requests = [];
  const chrome = {
    runtime:{id:'extension', onMessage:{addListener:fn => listeners.push(fn)}},
    storage:{local:{get:async defaults => ({...defaults, ...stored})}}
  };
  vm.runInNewContext(read('background.js'), {
    chrome, URL, URLSearchParams, AbortSignal,
    fetch:async url => {
      requests.push(url);
      return {ok:true, json:async () => ({translated:true})};
    }
  });
  const translate = () => new Promise(resolve => listeners[0](
    {type:'dsm-google-translate', source:'en', target:'tr', text:'example'},
    {id:'extension'}, resolve
  ));
  assert.ok((await translate()).error);
  assert.equal(requests.length, 0);
  stored.googleTranslationEnabled = true;
  assert.equal((await translate()).data.translated, true);
  assert.equal(requests[0].hostname, 'translate.googleapis.com');
  assert.equal(requests[0].searchParams.get('q'), 'example');
  stored.googleTranslationEnabled = false;
  assert.ok((await translate()).error);
  assert.equal(requests.length, 1);
});

test('only the YouTube language bridge runs in the page world and returns the active language', () => {
  const manifest = JSON.parse(read('manifest.json'));
  const pageScripts = manifest.content_scripts.filter(entry => entry.world === 'MAIN');
  assert.equal(pageScripts.length, 1);
  assert.deepEqual(pageScripts[0].js, ['youtube-language.js']);
  assert.deepEqual(pageScripts[0].matches, ['https://*.youtube.com/*']);
  const content = manifest.content_scripts.find(entry => entry.js.includes('content.js'));
  assert.equal(content.world || 'ISOLATED', 'ISOLATED');
  let receive, reply;
  vm.runInNewContext(read('youtube-language.js'), {
    location:{hostname:'www.youtube.com'}, CustomEvent,
    document:{addEventListener(name, fn) { assert.equal(name, 'dsm-request-caption-language'); receive = fn; }}
  });
  receive({target:{id:'movie_player', getOption:() => ({languageCode:'en', translationLanguage:{languageCode:'tr'}}),
    dispatchEvent:event => {reply = event;}}});
  assert.equal(reply.type, 'dsm-caption-language');
  assert.equal(reply.detail, 'tr');
});
