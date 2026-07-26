#!/usr/bin/env node
const assert = require("assert");
const voice = require("../miniprogram/utils/voiceAuthStateMachine");

async function run() {
  const phases = [];
  let authorized = false;
  const wx = {
    getRecorderManager() { return {}; },
    getPrivacySetting({ success }) { success({ needAuthorization: true }); },
    requirePrivacyAuthorize({ success }) { success(); },
    getSetting({ success }) {
      success({ authSetting: authorized ? { "scope.record": true } : {} });
    },
    authorize({ success }) { authorized = true; success(); },
  };
  const ready = await voice.ensureVoiceReady(voice.createInitialState(), {
    wx,
    requireRecorder: true,
    onTransition: (state) => phases.push(state.phase),
  });
  assert.strictEqual(ready.ok, true);
  let state = voice.markRecording(ready.state);
  phases.push(state.phase);
  state = voice.markTranscribing(state);
  phases.push(state.phase);
  state = voice.markComposerFilled(state);
  phases.push(state.phase);
  assert.deepStrictEqual(phases, [
    voice.STATES.PRIVACY_AUTHORIZATION,
    voice.STATES.RECORD_AUTHORIZATION,
    voice.STATES.READY,
    voice.STATES.RECORDING,
    voice.STATES.TRANSCRIBING,
    voice.STATES.COMPOSER_FILLED,
  ]);
  console.log("test-voice-state-sequence: PASS");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
