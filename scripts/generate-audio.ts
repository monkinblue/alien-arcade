import 'dotenv/config';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const AUDIO_OUT_DIR = path.join(ROOT_DIR, 'public', 'audio');
const FLAK_AUDIO_OUT_DIR = path.join(AUDIO_OUT_DIR, 'flak');
const TRENCH_AUDIO_OUT_DIR = path.join(AUDIO_OUT_DIR, 'trench');
const MANIFEST_PATH = path.join(AUDIO_OUT_DIR, 'manifest.json');
const FLAK_MANIFEST_PATH = path.join(FLAK_AUDIO_OUT_DIR, 'manifest.json');
const TRENCH_MANIFEST_PATH = path.join(TRENCH_AUDIO_OUT_DIR, 'manifest.json');

const API_BASE = 'https://api.elevenlabs.io/v1';

interface SoundGenAsset {
  filename: string;
  prompt: string;
  loop: boolean;
  durationSeconds: number;
  promptInfluence: number;
}

interface VoiceCalloutAsset {
  filename: string;
  text: string;
}

interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  labels?: Record<string, string>;
}

interface AudioManifest {
  version: number;
  generatedAt: string | null;
  voiceId: string | null;
  assets: Record<
    string,
    {
      path: string;
      category: 'loop' | 'sfx' | 'voice';
      bytes: number;
    }
  >;
}

const SOUND_ASSETS: SoundGenAsset[] = [
  // Seamless Loops (eleven_text_to_sound_v2 with loop: true)
  {
    filename: 'ambient_crt_buzz.mp3',
    prompt:
      'Deep 1979 spacecraft cabin air-handler drone with 60Hz CRT transformer hum and faint analog static.',
    loop: true,
    durationSeconds: 10,
    promptInfluence: 0.5,
  },
  {
    filename: 'alien_eerie_ambience.mp3',
    prompt:
      'Subtle tasteful 1979 Alien movie dark deep-space ambient drone, distant hollow metallic ship hull resonance, lonely eerie low air duct breath, sparse haunting sci-fi tension, no music or percussion.',
    loop: true,
    durationSeconds: 12,
    promptInfluence: 0.68,
  },
  {
    filename: 'thruster_main_loop.mp3',
    prompt:
      'Deep thunderous SpaceX Starship Raptor rocket landing burn, massive roaring liquid methane flame exhaust, chest-rattling low sub-bass rumble and crackling Mach plume, warm HD recording, no high-pitched whine.',
    loop: true,
    durationSeconds: 8,
    promptInfluence: 0.68,
  },
  {
    filename: 'thruster_rcs_loop.mp3',
    prompt: 'Pressurized cold-gas attitude thruster hiss.',
    loop: true,
    durationSeconds: 5,
    promptInfluence: 0.5,
  },
  {
    filename: 'lv426_wind_loop.mp3',
    prompt: 'Howling alien silicate dust storm buffeting a metal hull.',
    loop: true,
    durationSeconds: 10,
    promptInfluence: 0.5,
  },

  // Crisp HD One-Shot SFX (eleven_text_to_sound_v2)
  {
    filename: 'nostromo_boot_sequence.mp3',
    prompt:
      '1979 sci-fi spacecraft mainframe computer awakening sequence, vintage analog synthesizer data chirps, stuttering electronic telemetry bleeps, relay switches clattering, magnetic tape drive whir, eerie cassette futurism.',
    loop: false,
    durationSeconds: 5.5,
    promptInfluence: 0.65,
  },
  {
    filename: 'computer_telemetry_chirp.mp3',
    prompt:
      '1979 retro sci-fi computer terminal thinking noises, rapid muted analog synth telemetry bleeps and soft electronic data handshake chirps.',
    loop: false,
    durationSeconds: 2.2,
    promptInfluence: 0.65,
  },
  {
    filename: 'tape_drive_servo.mp3',
    prompt:
      '1970s mainframe magnetic tape reel servo spin-up whir, muted solenoid relay latch, and subtle analog computer hum.',
    loop: false,
    durationSeconds: 2.6,
    promptInfluence: 0.6,
  },
  {
    filename: 'ui_keyclick.mp3',
    prompt:
      'Single close-mic ASMR dull muted deep thocky mechanical keyboard keycap press, dampened thick plastic thud, soft warm low-end, no sharp click or metallic ring.',
    loop: false,
    durationSeconds: 0.8,
    promptInfluence: 0.72,
  },
  {
    filename: 'ui_keyclick_alt.mp3',
    prompt:
      'Single soft muted deep ASMR thick plastic keycap thock, dampened vintage terminal key bottom-out, warm dull thud, zero harsh treble.',
    loop: false,
    durationSeconds: 0.8,
    promptInfluence: 0.72,
  },
  {
    filename: 'thruster_ignite.mp3',
    prompt:
      'Deep powerful SpaceX rocket engine ignition whoosh and low-end combustion thump, heavy liquid propellant flame light-off.',
    loop: false,
    durationSeconds: 1.4,
    promptInfluence: 0.65,
  },
  {
    filename: 'emergency_thrust_pulse.mp3',
    prompt:
      'EPIC massive solid rocket booster emergency abort ignition, explosive pyrotechnic bolt firing followed by deafening chest-shaking supersonic rocket exhaust blast wave and crackling afterburner roar, realistic cinema IMAX sound.',
    loop: false,
    durationSeconds: 3.0,
    promptInfluence: 0.72,
  },
  {
    filename: 'computer_transition_dark.mp3',
    prompt:
      'Dark scary high-definition 1979 sci-fi mainframe transition sound, deep ominous sub-bass data surge, eerie metallic magnetic tape head sweep, unsettling low analog telemetry resonance.',
    loop: false,
    durationSeconds: 2.4,
    promptInfluence: 0.7,
  },
  {
    filename: 'computer_sector_engage.mp3',
    prompt:
      'Heavy ominous sci-fi spacecraft orbital clamp release and dark computer telemetry lock sound, deep resonant industrial thud followed by eerie descending analog mainframe frequency sweep.',
    loop: false,
    durationSeconds: 2.0,
    promptInfluence: 0.7,
  },
  {
    filename: 'computer_touchdown_confirm.mp3',
    prompt:
      'Atmospheric dark 1979 sci-fi computer telemetry confirmation chord, deep analog synthesizer harmonic lock, heavy magnetic tape relay seal, eerie solemn Nostromo mainframe tone.',
    loop: false,
    durationSeconds: 2.4,
    promptInfluence: 0.7,
  },
  {
    filename: 'button_latch_lock.mp3',
    prompt:
      'Heavy solid industrial steel cockpit latch engaging, chunky mechanical lock clunk and weighty damped metal bolt click.',
    loop: false,
    durationSeconds: 0.9,
    promptInfluence: 0.7,
  },
  {
    filename: 'keypress_return.mp3',
    prompt:
      'Heavy mechanical terminal carriage-return and metal cockpit toggle switch snap.',
    loop: false,
    durationSeconds: 1.0,
    promptInfluence: 0.5,
  },
  {
    filename: 'lidar_ping.mp3',
    prompt:
      'Resonant retro-futuristic sonar and LIDAR terrain sweep ping with metallic cavern decay.',
    loop: false,
    durationSeconds: 3.0,
    promptInfluence: 0.5,
  },
  {
    filename: 'alien_motion_ping.mp3',
    prompt:
      '1979 Alien movie handheld motion tracker single proximity pulse ping, eerie hollow analog electronic sonar blip with subtle micro relay flutter, tense retro sci-fi.',
    loop: false,
    durationSeconds: 0.9,
    promptInfluence: 0.72,
  },
  {
    filename: 'proximity_klaxon.mp3',
    prompt: 'Tense 1979 Nostromo-style industrial electronic warning klaxon.',
    loop: false,
    durationSeconds: 1.5,
    promptInfluence: 0.5,
  },
  {
    filename: 'landing_soft_mech.mp3',
    prompt:
      'High-definition realistic spacecraft soft touchdown, heavy pneumatic hydraulic landing struts compressing smoothly, mechanical magnetic pad clamps locking shut, brief residual gas vent.',
    loop: false,
    durationSeconds: 2.5,
    promptInfluence: 0.68,
  },
  {
    filename: 'landing_hard_thud.mp3',
    prompt:
      'Crisp high-definition heavy spacecraft hard landing thud, violent solid metal landing gear slam onto pad, deep structural shock thump and hydraulic groan.',
    loop: false,
    durationSeconds: 2.2,
    promptInfluence: 0.7,
  },
  {
    filename: 'landing_strut_thud.mp3',
    prompt:
      'Heavy hydraulic shock compression and metallic landing pad lock clang.',
    loop: false,
    durationSeconds: 1.8,
    promptInfluence: 0.5,
  },
  {
    filename: 'hull_explosion.mp3',
    prompt:
      'High-definition realistic cinematic spacecraft explosion, violent pressurized hull rupture, thunderous fuel tank detonation shockwave, tearing metal debris, deep sub-bass boom.',
    loop: false,
    durationSeconds: 4.5,
    promptInfluence: 0.7,
  },

  // Hadley's Perimeter (UA 571-C Tactical Sentry Defense) Organic Creature & Napalm HD Assets
  // Note: UA 571-C Pulse Sentry gunfire + rolling corridor echoes are 100% custom physical DSP!
  {
    filename: 'incinerator_whoosh.mp3',
    prompt:
      'Deep pressurized liquid-napalm flamethrower ignition whump and heavy rich fuel-fire whoosh, warm analog cinema foley recording, deep low-end thermal bloom, no harsh high hiss.',
    loop: false,
    durationSeconds: 1.8,
    promptInfluence: 0.72,
  },
  {
    filename: 'napalm_burn_loop.mp3',
    prompt:
      'Rich continuous burning liquid napalm fire pool in an enclosed industrial corridor, deep warm oil-flame combustion roar and gentle organic fire undulation, high-definition foley.',
    loop: true,
    durationSeconds: 7.0,
    promptInfluence: 0.7,
  },
  {
    filename: 'alien_screech_01.mp3',
    prompt:
      '1986 Aliens movie Xenomorph warrior creature shriek, terrifying high-pitched raspy primate-serpent scream with wet chitinous hiss tail, authentic 1980s sci-fi horror creature vocalization, no music.',
    loop: false,
    durationSeconds: 2.0,
    promptInfluence: 0.76,
  },
  {
    filename: 'alien_screech_02.mp3',
    prompt:
      'Agonized sci-fi alien creature hit shriek, sudden sharp high-pitched inhuman squeal cutting into a vicious guttural serpent hiss, 1986 Aliens movie monster sound effect, no music.',
    loop: false,
    durationSeconds: 1.6,
    promptInfluence: 0.75,
  },
  {
    filename: 'alien_screech_03.mp3',
    prompt:
      'Frantic skittering alien creature pack chittering and overlapping high-pitched juvenile xenomorph shrieks inside a metal air duct, 1980s sci-fi horror sound effect, no music.',
    loop: false,
    durationSeconds: 2.2,
    promptInfluence: 0.74,
  },
  {
    filename: 'alien_screech_04.mp3',
    prompt:
      'Wounded sci-fi alien creature dying wail, piercing raspy high-pitched monster screech pitching downward into a hollow wet throat rattle, 1986 Aliens horror foley, no music.',
    loop: false,
    durationSeconds: 2.2,
    promptInfluence: 0.75,
  },
  {
    filename: 'alien_screech_05.mp3',
    prompt:
      'Aggressive hunting alien xenomorph double-shriek and sharp ferocious cobra-like vocal hiss lunging in a metal corridor, 1986 sci-fi horror creature vocalization, no music.',
    loop: false,
    durationSeconds: 1.8,
    promptInfluence: 0.75,
  },
  {
    filename: 'alien_screech_06.mp3',
    prompt:
      'Large armored alien queen-guard praetorian ferocious resonant shriek-bellow, deep guttural insectoid-primate roar erupting into a raspy scream, 1980s sci-fi monster foley, no music.',
    loop: false,
    durationSeconds: 2.4,
    promptInfluence: 0.74,
  },
  {
    filename: 'alien_screech_07.mp3',
    prompt:
      'Chaotic multiple alien creatures screeching, hissing, and shrieking over each other in a frantic sci-fi corridor swarm attack, 1986 Aliens movie horror chaos foley, no music.',
    loop: false,
    durationSeconds: 2.8,
    promptInfluence: 0.74,
  },
  {
    filename: 'alien_screech_08.mp3',
    prompt:
      'Eerie sibilant alien creature throat hiss suddenly erupting into a piercing high-pitched raspy banshee shriek, vintage 1980s sci-fi horror monster sound effect, no music.',
    loop: false,
    durationSeconds: 1.9,
    promptInfluence: 0.75,
  },
  {
    filename: 'sentry_rearm_belt.mp3',
    prompt:
      'Loud punchy close-mic military belt-fed machine gun full reload sequence foley: heavy steel ammo drum unlatching and clunking open, loud rattling brass ammo belt links feeding rapidly into a steel receiver tray, heavy steel top cover slamming shut with loud solid metallic impact, and forceful mechanical charging handle racking back and locking forward into battery, crisp heavy cinema weapon foley, no gunfire, no voice, no music.',
    loop: false,
    durationSeconds: 2.8,
    promptInfluence: 0.78,
  },
  {
    filename: 'core_breach_alert.mp3',
    prompt:
      'Deep resonant 1979 Nostromo sci-fi spacecraft mainframe containment breach system alert, two slow solemn low-frequency baritone dual-tone shipboard warning chimes with warm sub-bass hull resonance and cavernous industrial corridor decay, ominous deep submarine and reactor deck computer alert tone, no high-pitched screech, no explosion, no voice, no music.',
    loop: false,
    durationSeconds: 3.0,
    promptInfluence: 0.76,
  },
  {
    filename: 'sentry_deploy_tripod.mp3',
    prompt:
      'Heavy metal tripod machine gun sentry turret being planted and locked onto a steel grate floor, weighty metal tripod legs unfolding with a solid thud, heavy receiver mounting clamp snapping shut, crisp mechanical foley, no gunfire, no music.',
    loop: false,
    durationSeconds: 1.4,
    promptInfluence: 0.76,
  },
  {
    filename: 'hardware_deploy_mount.mp3',
    prompt:
      'Heavy industrial sci-fi metal tactical equipment unit clamping and bolting onto a steel spacecraft deck plate, chunky mechanical latch lock and solid metal thud, crisp foley, no music.',
    loop: false,
    durationSeconds: 1.1,
    promptInfluence: 0.74,
  },

  // Hadley's Perimeter 2.0 HD Foley, Reactor Dynamics, Bosses & New Weapons
  {
    filename: 'perim_reactor_hum_loop.mp3',
    prompt:
      'Deep pressurized industrial spacecraft nuclear fusion reactor turbine hum and steady warm 60Hz high-voltage power bus transformer drone heard inside an armored control bunker, seamless loop, dark 1979 sci-fi ambience, no music.',
    loop: true,
    durationSeconds: 8.0,
    promptInfluence: 0.78,
  },
  {
    filename: 'perim_breaker_blackout.mp3',
    prompt:
      'Massive heavy industrial high-voltage electrical circuit breaker slamming open with a violent metallic clunk followed by deep powering-down reactor turbine groan fading into eerie silence, realistic 1980s sci-fi industrial foley, no music.',
    loop: false,
    durationSeconds: 2.2,
    promptInfluence: 0.82,
  },
  {
    filename: 'perim_breaker_restore.mp3',
    prompt:
      'Heavy steel industrial high-voltage electrical contactor slamming shut followed by rapid rising capacitor charge whine and reactor bus powering back online, realistic sci-fi control room foley, no music.',
    loop: false,
    durationSeconds: 1.6,
    promptInfluence: 0.8,
  },
  {
    filename: 'perim_airlock_purge.mp3',
    prompt:
      'Violent spacecraft airlock emergency decompression blowout, loud pneumatic pressure hatch release followed by explosive rushing vacuum wind roar sucking through a steel corridor and heavy bulkhead lock slam, cinema foley, no music.',
    loop: false,
    durationSeconds: 1.9,
    promptInfluence: 0.82,
  },
  {
    filename: 'perim_cryo_blast.mp3',
    prompt:
      'High-pressure liquid nitrogen cryogenic floor valve erupting inside a steel corridor, sharp pressurized cold gas blast hiss followed by crackling instant frost freezing sound, crisp industrial foley, no music.',
    loop: false,
    durationSeconds: 1.2,
    promptInfluence: 0.8,
  },
  {
    filename: 'perim_arc_weld.mp3',
    prompt:
      'Heavy steel bulkhead blast door slamming closed followed by intense sizzling high-voltage electric arc welding torch crackling and spitting sparks onto thick metal plate, realistic industrial foley, no music.',
    loop: false,
    durationSeconds: 1.5,
    promptInfluence: 0.82,
  },
  {
    filename: 'perim_flare_ignite.mp3',
    prompt:
      'Sharp tactical military magnesium strobe flare pyrotechnic pop ignition followed by intense bright crackling chemical flare burn hiss inside a metal hallway, realistic foley, no music.',
    loop: false,
    durationSeconds: 1.2,
    promptInfluence: 0.8,
  },
  {
    filename: 'perim_overclock_surge.mp3',
    prompt:
      'Heavy industrial sci-fi power bus capacitor overload surge, deep electrical relay engagement thump followed by rising high-energy analog transformer whine and energized magnetic hum, 1980s sci-fi foley, no music.',
    loop: false,
    durationSeconds: 1.3,
    promptInfluence: 0.8,
  },
  {
    filename: 'perim_door_batter.mp3',
    prompt:
      'Heavy terrifying creature slamming violently against a thick welded steel bulkhead door in a dark industrial corridor, loud booming hollow metal impact clang and stressed groaning steel vibration, horror cinema foley, no music.',
    loop: false,
    durationSeconds: 0.95,
    promptInfluence: 0.82,
  },
  {
    filename: 'perim_acid_sizzle.mp3',
    prompt:
      'Intense corrosive molecular acid eating violently through thick steel deck plating, wet bubbling chemical fizz and sharp metallic dissolving sizzle, 1986 Aliens horror cinema foley, no music.',
    loop: false,
    durationSeconds: 1.1,
    promptInfluence: 0.82,
  },
  {
    filename: 'perim_rail_lance.mp3',
    prompt:
      'Single massive thunderous 120mm anti-materiel cannon detonation firing inside a cavernous steel industrial corridor, earth-shaking concussive shockwave crack and deep sub-bass blast boom with long echoing metallic hallway rumble, raw realistic heavy military ordnance, no sci-fi laser, no whine, no voice, no music.',
    loop: false,
    durationSeconds: 2.2,
    promptInfluence: 0.86,
  },
  {
    filename: 'perim_queen_roar.mp3',
    prompt:
      'Terrifying gigantic 1986 Aliens movie Xenomorph Queen matriarch roar, earth-shaking deep sub-bass resonant reptilian-insectoid bellow erupting into a ferocious piercing shriek echoing down huge metallic industrial halls, no music.',
    loop: false,
    durationSeconds: 2.6,
    promptInfluence: 0.84,
  },
  {
    filename: 'perim_shock_coil.mp3',
    prompt:
      'High-voltage industrial Tesla arc shock coil discharging a violent blue electrical lightning bolt snap and crackling ozone arc buzz inside a metal corridor, realistic foley, no music.',
    loop: false,
    durationSeconds: 0.95,
    promptInfluence: 0.82,
  },
  {
    filename: 'perim_claymore_blast.mp3',
    prompt:
      'Directional military claymore corridor mine detonating violently inside an enclosed steel colony hallway, sharp concussive blast bang with spraying metallic shrapnel clatter and muffled hallway boom, cinema foley, no music.',
    loop: false,
    durationSeconds: 1.4,
    promptInfluence: 0.84,
  },
  {
    filename: 'perim_shatter_crunch.mp3',
    prompt:
      'Sharp visceral crystalline frozen ice-armor shattering crunch and brittle fracture snap when heavy bullets crack frozen carapace, crisp cinema impact foley, no music.',
    loop: false,
    durationSeconds: 0.8,
    promptInfluence: 0.8,
  },
  {
    filename: 'perim_thermal_steam.mp3',
    prompt:
      'Superheated heavy machine gun barrel emergency pressurized steam relief valve venting loudly, sharp sudden hissing hot steam burst fading quickly, realistic mechanical weapon foley, no music.',
    loop: false,
    durationSeconds: 1.1,
    promptInfluence: 0.8,
  },
  {
    filename: 'perim_wave_clear.mp3',
    prompt:
      'Crisp 1979 Nostromo sci-fi tactical command console wave-cleared confirmation, heavy hydraulic perimeter lock clunk followed by warm solemn analog dual-tone avionics telemetry chime, no music.',
    loop: false,
    durationSeconds: 1.5,
    promptInfluence: 0.78,
  },
];

// Program #3: ORBITAL INTERCEPT // FLAK NET (Hyper-Realistic Movie-Quality Field Recordings)
// Saved cleanly into public/audio/flak/
const FLAK_NET_SOUND_ASSETS: SoundGenAsset[] = [
  {
    filename: 'flak_launch_light_01.mp3',
    prompt:
      'Single loud 120mm tank main gun firing outdoors, raw explosive cannon boom, powerful air-pressure shockwave blast and deep thunderous concussion echoing briefly across open terrain, realistic field recording, no music.',
    loop: false,
    durationSeconds: 1.5,
    promptInfluence: 0.78,
  },
  {
    filename: 'flak_launch_light_02.mp3',
    prompt:
      'Single heavy artillery howitzer cannon firing one live round outdoors, massive explosive powder charge detonation inside steel barrel, heavy concussive shockwave boom and crisp natural open-air decay, raw realistic documentary audio, no music.',
    loop: false,
    durationSeconds: 1.5,
    promptInfluence: 0.78,
  },
  {
    filename: 'flak_launch_light_03.mp3',
    prompt:
      'Single heavy naval deck cannon firing one live shell, crisp powerful gunpowder cannon blast, visceral chest-punching air concussion and deep natural outdoor blast echo, hyper-realistic cinema war foley, no music.',
    loop: false,
    durationSeconds: 1.5,
    promptInfluence: 0.78,
  },
  {
    filename: 'flak_launch_emp.mp3',
    prompt:
      'Massive heavy sci-fi EMP mortar cannon launch, chest-shaking deep hydraulic mortar tube blast followed by surging high-voltage analog capacitor discharge crackle and resonant electromagnetic coil whine, IMAX blockbuster sound design, no music.',
    loop: false,
    durationSeconds: 1.7,
    promptInfluence: 0.78,
  },
  {
    filename: 'flak_detonate_airburst_01.mp3',
    prompt:
      'Single massive high-explosive C4 charge detonating in open air, crisp violent instantaneous shockwave bang erupting into a deep realistic chest-shaking explosion boom and natural outdoor thunderous echo tail, authentic cinema field recording, no music.',
    loop: false,
    durationSeconds: 2.6,
    promptInfluence: 0.8,
  },
  {
    filename: 'flak_detonate_airburst_02.mp3',
    prompt:
      'Single heavy artillery shell exploding mid-air with one decisive crisp concussive blast, powerful realistic TNT detonation shockwave, rich deep boom and authentic distant valley thunder decay, raw blockbuster movie foley, no music.',
    loop: false,
    durationSeconds: 2.6,
    promptInfluence: 0.8,
  },
  {
    filename: 'flak_detonate_airburst_03.mp3',
    prompt:
      'Single powerful military demolition bomb explosion in open sky, decisive loud concussive blast bang, thick realistic sub-bass pressure wave and natural rolling acoustic thunder fade-out, realistic cinema documentary audio, no music.',
    loop: false,
    durationSeconds: 2.6,
    promptInfluence: 0.8,
  },
  {
    filename: 'flak_detonate_emp.mp3',
    prompt:
      'Colossal blockbuster sci-fi EMP shockwave detonation in the sky, earth-shaking seismic sub-bass concussive thump combined with an iconic descending high-voltage analog electromagnetic bass drop and crackling ionized air shockwave, IMAX cinema sound design, no music.',
    loop: false,
    durationSeconds: 2.8,
    promptInfluence: 0.78,
  },
  {
    filename: 'battery_reload_clank.mp3',
    prompt:
      'Subtle muted realistic heavy tank turret breech bolt sliding shut and locking softly, heard from inside an armored command bunker, tight damped low-mid mechanical steel latch thuck, quiet heavy precision machinery, brief, no harsh clang, no loud hiss, no beep, no music.',
    loop: false,
    durationSeconds: 0.55,
    promptInfluence: 0.8,
  },
  {
    filename: 'battery_reload_clank_02.mp3',
    prompt:
      'Quiet realistic naval gun autoloader chamber latch clicking softly into place behind thick steel armor bulkhead, subtle damped hydraulic seat and solid muted metal lock click, understated immersive military foley, brief, no shrill ringing, no hiss, no music.',
    loop: false,
    durationSeconds: 0.55,
    promptInfluence: 0.8,
  },
  {
    filename: 'dome_breach_impact.mp3',
    prompt:
      'Catastrophic realistic IMAX underground bunker destruction from orbital kinetic strike, terrifying massive seismic sub-bass impact explosion followed by violent tearing structural steel girders buckling, heavy reinforced concrete collapsing inward, roaring subterranean debris avalanche and prolonged ominous bass rumble fading into dark dust, no cartoon glass, no siren, no music.',
    loop: false,
    durationSeconds: 5.5,
    promptInfluence: 0.82,
  },
  {
    filename: 'radar_ping_lock.mp3',
    prompt:
      'Short tense 1979 military bunker radar threat-acquisition alert blip, dry crisp dual-pulse analog electronic cockpit radar warning chirp in mid-low register matching vintage tactical defense telemetry, urgent and gritty, zero bell ring, zero chime, no submarine sonar ding, no music.',
    loop: false,
    durationSeconds: 0.7,
    promptInfluence: 0.82,
  },
  {
    filename: 'dome_lock_alarm.mp3',
    prompt:
      'Urgent crisp 1979 military bunker radar collision warning alarm, rapid tense dual-tone analog electronic cockpit lock-on alert beeps signaling imminent impact on a habitat dome, authentic sci-fi thriller control room audio, no music.',
    loop: false,
    durationSeconds: 1.6,
    promptInfluence: 0.78,
  },
  {
    filename: 'mirv_split_warning.mp3',
    prompt:
      'Sharp high-priority 1979 tactical defense radar threat-separation warning, urgent stuttering tri-tone analog military radar alert klaxon signaling incoming warhead MIRV split, crisp clean control-room alarm, no music.',
    loop: false,
    durationSeconds: 1.8,
    promptInfluence: 0.78,
  },
  {
    filename: 'wave_incoming_klaxon.mp3',
    prompt:
      'Iconic deep cinematic 1979 sci-fi colony orbital defense battle-stations horn, ominous resonant low-mid bunker klaxon siren sweep announcing incoming orbital barrage, movie quality sound design, no music.',
    loop: false,
    durationSeconds: 2.5,
    promptInfluence: 0.78,
  },
  {
    filename: 'ion_jammer_loop.mp3',
    prompt:
      'Intense continuous high-voltage electromagnetic ion storm radar jamming interference, crackling analog CRT static arcs, sweeping low-frequency radio frequency distortion hum, and eerie ionized plasma sizzle, cinema sci-fi foley, no music.',
    loop: true,
    durationSeconds: 7.0,
    promptInfluence: 0.76,
  },
  {
    filename: 'meteor_deflect_impact.mp3',
    prompt:
      'Massive kinetic shockwave deflection impact on an armored meteor, heavy resonant metallic-rock crunch, visceral bass thud, and screaming high-energy ricochet spark ping, IMAX sci-fi action foley, no music.',
    loop: false,
    durationSeconds: 1.4,
    promptInfluence: 0.78,
  },
  {
    filename: 'orbital_droppod_restore.mp3',
    prompt:
      'Cinematic sci-fi orbital supply drop-pod touchdown, brief retro-thruster landing burst, solid hydraulic clamping lock onto steel deck, pressurized airlock hiss, and crisp uplifting 1979 mainframe confirmation chime, no music.',
    loop: false,
    durationSeconds: 2.6,
    promptInfluence: 0.76,
  },
  // Every-5-Rounds Orbital Siege Dreadnought Boss Event Unique Realistic Cinema SFX
  {
    filename: 'boss_arrival_horn.mp3',
    prompt:
      'Terrifying massive sci-fi warship descending through storm clouds, colossal deep subsonic iron foghorn resonance echoing across mountains with heavy atmospheric sonic pressure boom, realistic IMAX cinema sound design, dark ominous weight, no music.',
    loop: false,
    durationSeconds: 3.2,
    promptInfluence: 0.82,
  },
  {
    filename: 'boss_salvo_fire.mp3',
    prompt:
      'Heavy battleship multi-barrel artillery battery firing a triple salvo of massive orbital kinetic shells, three deep concussive hydraulic cannon thumps in rapid aggressive succession with steel recoil slam, realistic war film audio, no music.',
    loop: false,
    durationSeconds: 1.6,
    promptInfluence: 0.8,
  },
  {
    filename: 'boss_hull_hit.mp3',
    prompt:
      'Artillery shell direct impact hitting massive battleship thick steel armor plating, brutal metallic crunch, heavy concussive blast thud and deep resonant hollow iron hull clang, realistic cinema foley, no music.',
    loop: false,
    durationSeconds: 1.1,
    promptInfluence: 0.8,
  },
  {
    filename: 'boss_destroyed.mp3',
    prompt:
      'Colossal warship catastrophic destruction in high atmosphere, violent cascading internal reactor detonations tearing thick steel hull apart followed by a massive sky-splitting sub-bass explosion shockwave and roaring falling debris tail, IMAX war film audio, no music.',
    loop: false,
    durationSeconds: 4.2,
    promptInfluence: 0.82,
  },
];

// Program #4 ("DERELICT TRENCH // F-16 VECTOR") Realism-First Cockpit Audio -> public/audio/trench/
const TRENCH_SOUND_ASSETS: SoundGenAsset[] = [
  {
    filename: 'f16_turbine_loop.mp3',
    prompt:
      'Muffled cockpit-interior Pratt & Whitney F100 jet turbine hum and steady airflow hiss, realistic military fighter jet cabin ambience, warm low-mid pressurized canopy sound, seamless loop, no music.',
    loop: true,
    durationSeconds: 10,
    promptInfluence: 0.78,
  },
  {
    filename: 'f16_afterburner_roar.mp3',
    prompt:
      'Deep, heavy low-frequency cockpit-muffled fighter jet afterburner ignition thump and sustained broadband sub-bass rumble heard through pressurized canopy, realistic military aviation foley, seamless loop, no music.',
    loop: true,
    durationSeconds: 8,
    promptInfluence: 0.8,
  },
  {
    filename: 'm61_vulcan_burst.mp3',
    prompt:
      'Extremely loud, aggressive, close-proximity cockpit-interior M61A1 Vulcan 20mm rotary cannon firing right next to the pilot, heavy chest-rattling mechanical bass buzz and rapid 100Hz brrrt, Hollywood fighter jet movie sound design, raw and forceful, zero sci-fi laser.',
    loop: false,
    durationSeconds: 2.0,
    promptInfluence: 0.88,
  },
  // Note: AIM-9M Sidewinder IR seeker growl & 840Hz reticle lock tone are synthesized with
  // physical-model Web Audio DSP in TrenchAudioEngine.ts for rock-steady, accurate, non-intrusive audio.
  {
    filename: 'aim9_missile_launch.mp3',
    prompt:
      'Realistic fighter jet under-wing AIM-9 missile rail release clunk followed by pressurized solid rocket motor whoosh fading forward downrange, cockpit-interior military aviation foley, no music.',
    loop: false,
    durationSeconds: 1.5,
    promptInfluence: 0.82,
  },
  {
    filename: 'cmds_flare_pop.mp3',
    prompt:
      'Crisp metallic pneumatic countermeasure dispenser pop followed by brief muffled chemical flare ignition hiss heard from inside a military fighter jet cockpit, realistic aviation foley, no music.',
    loop: false,
    durationSeconds: 1.1,
    promptInfluence: 0.82,
  },
  {
    filename: 'cmds_flare_thud.mp3',
    prompt:
      'Single heavy muffled pyrotechnic countermeasure flare dispenser cartridge thud heard from inside a pressurized military fighter jet cockpit, solid deep low-frequency fuselage pneumatic thump with tiny crisp metallic release clack and very brief faint sizzle, dry realistic cockpit foley, no music.',
    loop: false,
    durationSeconds: 0.55,
    promptInfluence: 0.85,
  },
  {
    filename: 'hull_impact_thud.mp3',
    prompt:
      'Deep, muffled structural fighter aircraft airframe impact thud and brief low-frequency cockpit vibration rattle, realistic pressurized fuselage concussion, zero metallic screeching, no music.',
    loop: false,
    durationSeconds: 1.3,
    promptInfluence: 0.82,
  },
  {
    filename: 'trench_vulcan_burst.mp3',
    prompt:
      'Authentic A-10 GAU-8 and F-16 M61A1 Vulcan 20mm rotary cannon firing burst heard from inside cockpit, visceral low-frequency 100Hz mechanical buzz BRRRT with heavy sub-bass punch and brief muffled barrel spin-down gas-vent tail, cinema quality aviation foley, no music.',
    loop: false,
    durationSeconds: 1.6,
    promptInfluence: 0.84,
  },
  {
    filename: 'trench_cannon_fire_01.mp3',
    prompt:
      'Realistic fighter jet twin 20mm rotary nose autocannon short crisp firing burst heard from inside cockpit, punchy low-mid mechanical breech thump and tight metallic blast snap, authentic aviation combat foley, no music.',
    loop: false,
    durationSeconds: 0.65,
    promptInfluence: 0.8,
  },
  {
    filename: 'trench_cannon_fire_02.mp3',
    prompt:
      'Realistic military attack aircraft heavy 20mm cannon burst heard through pressurized cockpit canopy, solid bass mechanical cannon punch with crisp steel chamber action, authentic aviation audio, no music.',
    loop: false,
    durationSeconds: 0.65,
    promptInfluence: 0.8,
  },
  {
    filename: 'trench_conduit_blast.mp3',
    prompt:
      'High-voltage industrial plasma conduit exploding violently inside a steel canyon trench, sharp concussive detonation bang with shattering metal debris and brief electrical arc crackle fading in cavernous echo, movie quality foley, no music.',
    loop: false,
    durationSeconds: 2.2,
    promptInfluence: 0.8,
  },
  {
    filename: 'trench_graze_whoosh.mp3',
    prompt:
      'Supersonic fighter jet razor-close high-speed Doppler flyby past a massive steel wall, sudden intense rushing air whip and crisp aerodynamic pressure whoosh with brief metallic spark zip, realistic aviation cinema foley, no music.',
    loop: false,
    durationSeconds: 0.75,
    promptInfluence: 0.82,
  },
  {
    filename: 'trench_rcs_roll.mp3',
    prompt:
      'Crisp pressurized aerospace reaction-control attitude thruster burst firing to snap-roll a spacecraft, tight short nitrogen gas jet hiss and subtle hydraulic servo lock click inside cockpit, realistic sci-fi aviation foley, no music.',
    loop: false,
    durationSeconds: 0.6,
    promptInfluence: 0.8,
  },
  {
    filename: 'trench_boost_gate.mp3',
    prompt:
      'Clean futuristic military cockpit afterburner thrust-gate lock confirmation, warm analog harmonic double tone paired with a brief smooth turbine intake surge, authentic 1980s aerospace avionics audio, no music.',
    loop: false,
    durationSeconds: 1.1,
    promptInfluence: 0.78,
  },
  {
    filename: 'trench_hull_impact.mp3',
    prompt:
      'Violent fighter aircraft wingtip scraping and slamming against a reinforced steel bulkhead at high speed, harsh tearing metal screech, heavy concussive fuselage crunch and cockpit frame shudder, realistic movie foley, no music.',
    loop: false,
    durationSeconds: 1.6,
    promptInfluence: 0.82,
  },
  {
    filename: 'trench_low_hull_alarm.mp3',
    prompt:
      'Authentic 1979 military fighter cockpit master caution warning tone, urgent dry dual-pulse analog avionics Betty alert chime indicating critical hull integrity, crisp clean control-room warning, no music.',
    loop: false,
    durationSeconds: 1.4,
    promptInfluence: 0.8,
  },
];

// Program #4 ("DERELICT TRENCH // VECTOR RUN") Cockpit VCS ("Betty") Voice Callouts -> public/audio/trench/
const TRENCH_VOICE_CALLOUTS: VoiceCalloutAsset[] = [
  {
    filename: 'betty_chaff_flare.mp3',
    text: 'Chaff, flare.',
  },
];

const VOICE_CALLOUTS: VoiceCalloutAsset[] = [
  {
    filename: 'voice_boot.mp3',
    text: 'Interface two-zero-three-seven ready. Orbital descent telemetry online.',
  },
  {
    filename: 'voice_wind.mp3',
    text: 'Caution. Severe atmospheric wind shear detected.',
  },
  {
    filename: 'voice_interference.mp3',
    text: 'Warning. Electromagnetic interference. Engage active radar.',
  },
  {
    filename: 'voice_fuel_low.mp3',
    text: 'Caution. Propellant reserves at twenty-five percent.',
  },
  {
    filename: 'voice_proximity.mp3',
    text: 'Descent rate.',
  },
  {
    filename: 'voice_pull_up.mp3',
    text: 'Pull up.',
  },
  {
    filename: 'voice_bank_angle.mp3',
    text: 'Bank angle.',
  },
  {
    filename: 'voice_lateral_drift.mp3',
    text: 'Lateral drift.',
  },
  {
    filename: 'voice_minimums.mp3',
    text: 'Minimums.',
  },
  {
    filename: 'voice_obstacle.mp3',
    text: 'Obstacle.',
  },
  {
    filename: 'voice_wind_shear_short.mp3',
    text: 'Wind shear.',
  },
  {
    filename: 'voice_touchdown.mp3',
    text: 'Contact light. Engine stop. Touchdown confirmed.',
  },
  {
    filename: 'voice_hull_breach.mp3',
    text: 'Critical hull breach. Descent signal lost.',
  },
  // Hadley's Perimeter 2.0 MU-TH-UR Intercom Voice Callouts
  {
    filename: 'perim_voice_grate_breach.mp3',
    text: 'Warning. Sub-floor grate breach.',
  },
  {
    filename: 'perim_voice_sentry_dry.mp3',
    text: 'Caution. Sentry ammunition depleted.',
  },
  {
    filename: 'perim_voice_door_failing.mp3',
    text: 'Alert. Bulkhead seal failing.',
  },
  {
    filename: 'perim_voice_overload.mp3',
    text: 'Warning. Reactor overload imminent.',
  },
  {
    filename: 'perim_voice_queen.mp3',
    text: 'Critical alert. Matriarch bio-signature detected.',
  },
  {
    filename: 'perim_voice_protocol.mp3',
    text: 'Tactical protocol requisition ready.',
  },
];

async function fileSizeBytes(filepath: string): Promise<number> {
  try {
    const stat = await fs.stat(filepath);
    return stat.isFile() ? stat.size : 0;
  } catch {
    return 0;
  }
}

async function resolveClinicalFemaleVoiceId(apiKey: string): Promise<string> {
  const envOverride = process.env.ELEVENLABS_VOICE_ID?.trim();
  if (envOverride) {
    console.log(`[MU-TH-UR] Using ELEVENLABS_VOICE_ID override: ${envOverride}`);
    return envOverride;
  }

  const fallbackRachelId = '21m00Tcm4TlvDq8ikWAM';
  try {
    const res = await fetch(`${API_BASE}/voices`, {
      method: 'GET',
      headers: { 'xi-api-key': apiKey },
    });
    if (!res.ok) {
      console.warn(`[MU-TH-UR] GET /v1/voices returned ${res.status}; falling back to default voice.`);
      return fallbackRachelId;
    }

    const data = (await res.json()) as { voices?: ElevenLabsVoice[] };
    const voices = data.voices ?? [];
    if (voices.length === 0) return fallbackRachelId;

    let bestVoice = voices[0];
    let bestScore = -999;

    for (const v of voices) {
      const labels = v.labels ?? {};
      const gender = (labels.gender ?? '').toLowerCase();
      const accent = (labels.accent ?? '').toLowerCase();
      const desc = `${labels.description ?? ''} ${labels.use_case ?? ''} ${v.name}`.toLowerCase();

      let score = 0;
      if (gender === 'female') score += 50;
      else if (gender === 'male') score -= 50;

      if (accent.includes('british') || accent.includes('english') || accent.includes('uk')) score += 20;
      else if (accent.includes('american') || accent.includes('neutral')) score += 10;

      if (desc.includes('calm')) score += 18;
      if (desc.includes('clinical') || desc.includes('clear') || desc.includes('narration')) score += 12;
      if (desc.includes('soft') || desc.includes('composed') || desc.includes('news')) score += 8;

      if (score > bestScore) {
        bestScore = score;
        bestVoice = v;
      }
    }

    console.log(`[MU-TH-UR] Selected voice "${bestVoice.name}" (${bestVoice.voice_id})`);
    return bestVoice.voice_id;
  } catch (err) {
    console.warn(`[MU-TH-UR] Failed to query /v1/voices (${String(err)}); using fallback ID.`);
    return fallbackRachelId;
  }
}

async function generateSoundEffect(apiKey: string, asset: SoundGenAsset, destPath: string): Promise<void> {
  const fullPayload: Record<string, unknown> = {
    text: asset.prompt,
    model_id: 'eleven_text_to_sound_v2',
    duration_seconds: asset.durationSeconds,
    prompt_influence: asset.promptInfluence,
  };
  if (asset.loop) {
    fullPayload.loop = true;
  }

  let res = await fetch(`${API_BASE}/sound-generation?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify(fullPayload),
  });

  // Automatic retry with minimal standard payload if optional params return HTTP 400/422
  if (!res.ok && (res.status === 400 || res.status === 422)) {
    console.warn(
      `  [WARN] Optional parameters returned ${res.status} for ${asset.filename}; retrying standard payload...`
    );
    res = await fetch(`${API_BASE}/sound-generation`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: asset.prompt,
        duration_seconds: asset.durationSeconds,
        prompt_influence: 0.5,
      }),
    });
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Sound Generation failed (${res.status}): ${errText}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  await fs.writeFile(destPath, Buffer.from(arrayBuffer));
}

async function generateVoiceCallout(
  apiKey: string,
  voiceId: string,
  asset: VoiceCalloutAsset,
  destPath: string
): Promise<void> {
  const sendTts = async (modelId: string): Promise<Response> => {
    const url = `${API_BASE}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`;
    return fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: asset.text,
        model_id: modelId,
        voice_settings: {
          stability: 0.86,
          similarity_boost: 0.78,
          style: 0.05,
          use_speaker_boost: true,
        },
      }),
    });
  };

  let res = await sendTts('eleven_multilingual_v2');
  if (!res.ok && (res.status === 400 || res.status === 422)) {
    res = await sendTts('eleven_monolingual_v1');
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`TTS Generation failed (${res.status}): ${errText}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  await fs.writeFile(destPath, Buffer.from(arrayBuffer));
}

async function writeManifestFromDisk(voiceId: string | null): Promise<AudioManifest> {
  const assets: AudioManifest['assets'] = {};

  for (const s of SOUND_ASSETS) {
    const fullPath = path.join(AUDIO_OUT_DIR, s.filename);
    const bytes = await fileSizeBytes(fullPath);
    if (bytes > 512) {
      const id = s.filename.replace(/\.mp3$/i, '');
      assets[id] = {
        path: `/audio/${s.filename}`,
        category: s.loop ? 'loop' : 'sfx',
        bytes,
      };
    }
  }

  const customStartPath = path.join(AUDIO_OUT_DIR, 'homeade_computer_start.m4a');
  const customStartBytes = await fileSizeBytes(customStartPath);
  if (customStartBytes > 512) {
    assets['homeade_computer_start'] = {
      path: '/audio/homeade_computer_start.m4a',
      category: 'sfx',
      bytes: customStartBytes,
    };
  }

  for (const v of VOICE_CALLOUTS) {
    const fullPath = path.join(AUDIO_OUT_DIR, v.filename);
    const bytes = await fileSizeBytes(fullPath);
    if (bytes > 512) {
      const id = v.filename.replace(/\.mp3$/i, '');
      assets[id] = {
        path: `/audio/${v.filename}`,
        category: 'voice',
        bytes,
      };
    }
  }

  const manifest: AudioManifest = {
    version: 2,
    generatedAt: Object.keys(assets).length > 0 ? new Date().toISOString() : null,
    voiceId,
    assets,
  };

  await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  return manifest;
}

async function writeFlakManifestFromDisk(): Promise<AudioManifest> {
  const assets: AudioManifest['assets'] = {};
  for (const s of FLAK_NET_SOUND_ASSETS) {
    const fullPath = path.join(FLAK_AUDIO_OUT_DIR, s.filename);
    const bytes = await fileSizeBytes(fullPath);
    if (bytes > 512) {
      const id = s.filename.replace(/\.mp3$/i, '');
      assets[id] = {
        path: `/audio/flak/${s.filename}`,
        category: s.loop ? 'loop' : 'sfx',
        bytes,
      };
    }
  }

  const manifest: AudioManifest = {
    version: 1,
    generatedAt: Object.keys(assets).length > 0 ? new Date().toISOString() : null,
    voiceId: null,
    assets,
  };

  await fs.mkdir(FLAK_AUDIO_OUT_DIR, { recursive: true });
  await fs.writeFile(FLAK_MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  return manifest;
}

async function writeTrenchManifestFromDisk(voiceId: string | null = null): Promise<AudioManifest> {
  const assets: AudioManifest['assets'] = {};
  for (const s of TRENCH_SOUND_ASSETS) {
    const fullPath = path.join(TRENCH_AUDIO_OUT_DIR, s.filename);
    const bytes = await fileSizeBytes(fullPath);
    if (bytes > 512) {
      const id = s.filename.replace(/\.mp3$/i, '');
      assets[id] = {
        path: `/audio/trench/${s.filename}`,
        category: s.loop ? 'loop' : 'sfx',
        bytes,
      };
    }
  }

  for (const v of TRENCH_VOICE_CALLOUTS) {
    const fullPath = path.join(TRENCH_AUDIO_OUT_DIR, v.filename);
    const bytes = await fileSizeBytes(fullPath);
    if (bytes > 512) {
      const id = v.filename.replace(/\.mp3$/i, '');
      assets[id] = {
        path: `/audio/trench/${v.filename}`,
        category: 'voice',
        bytes,
      };
    }
  }

  const manifest: AudioManifest = {
    version: 2,
    generatedAt: Object.keys(assets).length > 0 ? new Date().toISOString() : null,
    voiceId,
    assets,
  };

  await fs.mkdir(TRENCH_AUDIO_OUT_DIR, { recursive: true });
  await fs.writeFile(TRENCH_MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  return manifest;
}

async function main(): Promise<void> {
  const force = process.argv.includes('--force');
  const flakOnly = process.argv.includes('--flak') || process.argv.includes('--flak-only');
  const trenchOnly = process.argv.includes('--trench') || process.argv.includes('--trench-only');
  const onlyArg = process.argv.find((a) => a.startsWith('--only='));
  const onlySet = onlyArg
    ? new Set(
        onlyArg
          .slice('--only='.length)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      )
    : null;
  await fs.mkdir(AUDIO_OUT_DIR, { recursive: true });
  await fs.mkdir(FLAK_AUDIO_OUT_DIR, { recursive: true });
  await fs.mkdir(TRENCH_AUDIO_OUT_DIR, { recursive: true });

  console.log('====================================================================');
  console.log(
    trenchOnly
      ? ' INTERFACE 2037 // DERELICT TRENCH (PROGRAM 04) ELEVENLABS SFX PIPELINE'
      : flakOnly
        ? ' INTERFACE 2037 // FLAK NET (PROGRAM 03) ELEVENLABS SFX PIPELINE'
        : ' INTERFACE 2037 // ELEVENLABS HD AUDIO ASSET PIPELINE'
  );
  console.log('====================================================================');

  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey || apiKey === 'your_api_key_here') {
    const manifest = await writeManifestFromDisk(null);
    const flakManifest = await writeFlakManifestFromDisk();
    const trenchManifest = await writeTrenchManifestFromDisk();
    console.error('\n[ERROR] Missing valid ELEVENLABS_API_KEY in .env.');
    console.log(
      `[INFO] Synced manifests: core(${Object.keys(manifest.assets).length}), flak(${Object.keys(flakManifest.assets).length}), trench(${Object.keys(trenchManifest.assets).length}).`
    );
    process.exitCode = 1;
    return;
  }

  let generatedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  if (!flakOnly && !trenchOnly) {
    // 1. Core Sound Generation Assets (Programs 1 & 2)
    for (const asset of SOUND_ASSETS) {
      const id = asset.filename.replace(/\.mp3$/i, '');
      if (onlySet && !onlySet.has(id) && !onlySet.has(asset.filename)) {
        skippedCount++;
        continue;
      }
      const destPath = path.join(AUDIO_OUT_DIR, asset.filename);
      const existingBytes = await fileSizeBytes(destPath);
      if (existingBytes > 5120 && !force) {
        console.log(`[SKIP] ${asset.filename} (${(existingBytes / 1024).toFixed(1)} KB). Pass --force to regenerate.`);
        skippedCount++;
        continue;
      }

      process.stdout.write(`[GEN]  ${asset.filename} (v2${asset.loop ? ', loop' : ''})... `);
      try {
        await generateSoundEffect(apiKey, asset, destPath);
        const bytes = await fileSizeBytes(destPath);
        console.log(`OK (${(bytes / 1024).toFixed(1)} KB)`);
        generatedCount++;
      } catch (err) {
        console.log('FAILED');
        console.error(`       ${String(err)}`);
        failedCount++;
      }
    }
  }

  // 2. FLAK NET (Program 3) Spatial Military/Sci-Fi + Boss SFX -> public/audio/flak/
  if (!trenchOnly) {
    for (const asset of FLAK_NET_SOUND_ASSETS) {
      const id = asset.filename.replace(/\.mp3$/i, '');
      if (onlySet && !onlySet.has(id) && !onlySet.has(asset.filename)) {
        skippedCount++;
        continue;
      }
      const destPath = path.join(FLAK_AUDIO_OUT_DIR, asset.filename);
      const existingBytes = await fileSizeBytes(destPath);
      if (existingBytes > 5120 && !force) {
        console.log(`[SKIP] flak/${asset.filename} (${(existingBytes / 1024).toFixed(1)} KB). Pass --force to regenerate.`);
        skippedCount++;
        continue;
      }

      process.stdout.write(`[GEN]  flak/${asset.filename} (v2)... `);
      try {
        await generateSoundEffect(apiKey, asset, destPath);
        const bytes = await fileSizeBytes(destPath);
        console.log(`OK (${(bytes / 1024).toFixed(1)} KB)`);
        generatedCount++;
      } catch (err) {
        console.log('FAILED');
        console.error(`       ${String(err)}`);
        failedCount++;
      }
    }
  }

  // 3. DERELICT TRENCH (Program 4) Flight-Sim SFX -> public/audio/trench/
  if (!flakOnly) {
    for (const asset of TRENCH_SOUND_ASSETS) {
      const id = asset.filename.replace(/\.mp3$/i, '');
      if (onlySet && !onlySet.has(id) && !onlySet.has(asset.filename)) {
        skippedCount++;
        continue;
      }
      const destPath = path.join(TRENCH_AUDIO_OUT_DIR, asset.filename);
      const existingBytes = await fileSizeBytes(destPath);
      if (existingBytes > 5120 && !force) {
        console.log(`[SKIP] trench/${asset.filename} (${(existingBytes / 1024).toFixed(1)} KB). Pass --force to regenerate.`);
        skippedCount++;
        continue;
      }

      process.stdout.write(`[GEN]  trench/${asset.filename} (v2)... `);
      try {
        await generateSoundEffect(apiKey, asset, destPath);
        const bytes = await fileSizeBytes(destPath);
        console.log(`OK (${(bytes / 1024).toFixed(1)} KB)`);
        generatedCount++;
      } catch (err) {
        console.log('FAILED');
        console.error(`       ${String(err)}`);
        failedCount++;
      }
    }
  }

  let voiceId: string | null = null;
  if (!flakOnly) {
    // 3b. DERELICT TRENCH Cockpit VCS ("Betty") Callouts -> public/audio/trench/
    const wantedTrenchVoices = TRENCH_VOICE_CALLOUTS.filter((asset) => {
      if (!onlySet) return true;
      const id = asset.filename.replace(/\.mp3$/i, '');
      return onlySet.has(id) || onlySet.has(asset.filename);
    });
    if (wantedTrenchVoices.length > 0) {
      voiceId = await resolveClinicalFemaleVoiceId(apiKey);
    }
    for (const asset of wantedTrenchVoices) {
      const destPath = path.join(TRENCH_AUDIO_OUT_DIR, asset.filename);
      const existingBytes = await fileSizeBytes(destPath);
      if (existingBytes > 5120 && !force) {
        console.log(`[SKIP] trench/${asset.filename} (${(existingBytes / 1024).toFixed(1)} KB). Pass --force to regenerate.`);
        skippedCount++;
        continue;
      }

      process.stdout.write(`[TTS]  trench/${asset.filename} -> "${asset.text}"... `);
      try {
        await generateVoiceCallout(apiKey, voiceId!, asset, destPath);
        const bytes = await fileSizeBytes(destPath);
        console.log(`OK (${(bytes / 1024).toFixed(1)} KB)`);
        generatedCount++;
      } catch (err) {
        console.log('FAILED');
        console.error(`       ${String(err)}`);
        failedCount++;
      }
    }
  }

  if (!flakOnly && !trenchOnly) {
    // 4. MU-TH-UR 6000 TTS Callouts
    const wantedVoices = VOICE_CALLOUTS.filter((asset) => {
      if (!onlySet) return true;
      const id = asset.filename.replace(/\.mp3$/i, '');
      return onlySet.has(id) || onlySet.has(asset.filename);
    });
    if (wantedVoices.length > 0 && !voiceId) {
      voiceId = await resolveClinicalFemaleVoiceId(apiKey);
    }
    for (const asset of wantedVoices) {
      const destPath = path.join(AUDIO_OUT_DIR, asset.filename);
      const existingBytes = await fileSizeBytes(destPath);
      if (existingBytes > 5120 && !force) {
        console.log(`[SKIP] ${asset.filename} (${(existingBytes / 1024).toFixed(1)} KB). Pass --force to regenerate.`);
        skippedCount++;
        continue;
      }

      process.stdout.write(`[TTS]  ${asset.filename} -> "${asset.text}"... `);
      try {
        await generateVoiceCallout(apiKey, voiceId!, asset, destPath);
        const bytes = await fileSizeBytes(destPath);
        console.log(`OK (${(bytes / 1024).toFixed(1)} KB)`);
        generatedCount++;
      } catch (err) {
        console.log('FAILED');
        console.error(`       ${String(err)}`);
        failedCount++;
      }
    }
  }

  const flakManifest = await writeFlakManifestFromDisk();
  const trenchManifest = await writeTrenchManifestFromDisk(voiceId);
  const totalTrenchExpected = TRENCH_SOUND_ASSETS.length + TRENCH_VOICE_CALLOUTS.length;
  if (!flakOnly && !trenchOnly) {
    const manifest = await writeManifestFromDisk(voiceId);
    const totalExpected = SOUND_ASSETS.length + VOICE_CALLOUTS.length;
    console.log('\n====================================================================');
    console.log(` COMPLETE: ${generatedCount} generated, ${skippedCount} skipped, ${failedCount} failed.`);
    console.log(` MANIFEST: ${Object.keys(manifest.assets).length}/${totalExpected} core assets in public/audio/manifest.json`);
    console.log(` FLAK NET: ${Object.keys(flakManifest.assets).length}/${FLAK_NET_SOUND_ASSETS.length} assets in public/audio/flak/manifest.json`);
    console.log(` TRENCH  : ${Object.keys(trenchManifest.assets).length}/${totalTrenchExpected} assets in public/audio/trench/manifest.json`);
    console.log('====================================================================');
  } else {
    console.log('\n====================================================================');
    console.log(` COMPLETE: ${generatedCount} generated, ${skippedCount} skipped, ${failedCount} failed.`);
    console.log(` FLAK NET: ${Object.keys(flakManifest.assets).length}/${FLAK_NET_SOUND_ASSETS.length} assets in public/audio/flak/manifest.json`);
    console.log(` TRENCH  : ${Object.keys(trenchManifest.assets).length}/${totalTrenchExpected} assets in public/audio/trench/manifest.json`);
    console.log('====================================================================');
  }

  if (failedCount > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exitCode = 1;
});
