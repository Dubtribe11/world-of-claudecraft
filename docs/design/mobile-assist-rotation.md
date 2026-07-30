# Mobile Assist button (one-tap class rotation)

An optional touch control that turns the action ring's primary button into a
single press which fires the next ability in the player's class rotation.

## The problem

The touch HUD gives a thumb five paged action buttons at a time
(`MOBILE_ACTIONS_PER_PAGE`). A real rotation needs more presses than that in
sequence, and on a phone the player is also steering with the other thumb. The
result is that touch players either play a two-button rotation or spend the fight
cycling pages with the swap badge. The desktop bar has no such problem: 33 slots
across three rows, each on a key.

This feature closes that gap without changing what the classes do or what the
server allows.

## What it does

With `settings.mobileAssistRotation` on (off by default, Options > Interface >
Combat), on a touch layout:

- The ring's primary button (the biggest one, bottom right: `#mobile-action-attack`)
  stops being the Attack toggle and becomes the Assist button.
- Its face shows the icon of whichever ability comes next, with the same cooldown
  sweep, unusable dimming, out-of-range dimming and proc glow every other slot
  gets, because it derives through the same `action_bar_view` core.
- A tap casts that ability, and engages white swings if it is an attack.
- A tap with nothing selected acquires the nearest enemy first and starts
  swinging, exactly like the classic Attack button's first press. The next tap
  casts.
- A press and hold (>= `ASSIST_STOP_ATTACK_HOLD_MS`) while swinging stops
  auto-attack, which is the toggle-off the seat would otherwise no longer offer.
  It fires from a TIMER at the threshold, while the finger is still down, so the
  player feels it land; the release that ends that press does not also cast. See
  "The hold is timer-fired" below for why that is load-bearing rather than a
  detail.
- An assisted cast leaves a LONGER global cooldown than pressing the ability
  yourself. See "The global cooldown tax" below.
- Its accessible name reads "Action slot Assist: Fireball": it names the ability
  that will actually fire, through the existing `abilityUi.actionBar.slotAria` key.

With the setting off, nothing changes: the seat is the classic Attack toggle and
none of the assist code runs.

## The hold is timer-fired, not measured at release

The gesture was first shipped the other way round: `bindTouchTap` measured how
long the finger was down and the tap resolver classified the press at `pointerup`.
That is broken, and not subtly.

`pointerup` is dispatched on the main thread. On a phone rendering a 3D world the
main thread is busy, so the event is delivered well after the finger actually
lifted, and `Date.now()` read inside the handler measures dispatch latency rather
than contact time. Driving the real button through a headless client measured
300-900ms for taps that were instantaneous at the harness level. Because
auto-attack is on for the whole fight, the "swinging plus long press" branch was
live on every combat press, so roughly every other tap stopped the player's
swings instead of casting. The button read as dead.

Two changes fix it, and both are needed:

1. **The threshold is fired by a timer while the finger is down**
   (`TouchHoldSpec` in `src/ui/touch_tap.ts`), which is how every other
   long-press in this tree already works (the Chat button, touch item drag, the
   mobile context menu, pet autocast). A press the hold consumed does not also
   tap, and `onHold` returning false leaves the press an ordinary tap, which is
   what the seat does while Assist is off so the classic Attack toggle is
   untouched.
2. **The threshold is a deliberate hold, not a slow-tap boundary.** It sits past
   the mobile context menu's 650ms long-press, because a rare gesture sharing the
   hottest button in the game has to be unmistakable.

`assist_tap_core` therefore takes an explicit `stopAttackHold` boolean and no
duration at all: there is no measured hold anywhere in the path, so the failure
mode cannot come back by a caller reading the wrong clock.

## The global cooldown tax

An assisted press casts through `IWorld.castAssistedAbility` instead of
`castAbility`, and the only difference is the global cooldown it arms:
`ASSIST_GCD_PENALTY_MULT` longer (`src/sim/combat/assist_gcd.ts`).

Why a tax exists at all: the button plays a rotation no thumb could otherwise
reach, with perfect ordering and perfect upkeep. Untaxed that is free throughput
over a player working their own bar, so the trade is made explicit. The assist
keeps the convenience and gives back some of the speed; a player who wants the
fastest rotation still drives it themselves.

Why the GCD and not a damage modifier:

- It scales with USE. Every assisted press pays; a manual press in between never
  does, so a player who mixes the two pays exactly in proportion.
- It needs no per-ability balance table and cannot become a damage exploit: it
  never touches an ability's own numbers, only how soon the next press lands.
- It shows up in the UI for free. The action bar already paints
  `player.gcdRemaining`, so the longer sweep IS the feedback.
- Haste keeps helping. The tax is applied AFTER the class GCD, spell haste and
  the `MIN_GCD` floor, so an assisted rotation still scales with haste
  proportionally instead of having it cancelled out.

The flag is a client-declared intent the server trusts, like the rest of the cast
payload. That is deliberate: a client that lies about it is a client running its
own rotation script, which no server-side check distinguishes from a fast player
anyway, so the honest signal is what the tax is priced against. The flag can only
ever make the caster SLOWER, and the server reads it as an exact `=== 1` so a
malformed payload degrades to an ordinary cast rather than silently penalising a
player who never opted in. Options > Interface > Combat states the trade next to
the toggle (`hudChrome.options.mobileAssistRotationGcdNote`), so nobody discovers
it mid-fight.

## Why the primary seat, and not a new button

The ring is geometrically saturated. Five paged action buttons sit on an
equal-chord quarter arc at `--mobile-ring-radius`, and the Use / Target / page
toggle trio sits in the crescent hollow at `--mobile-ring-hollow`, with Jump on
the bottom row beyond the arc. Every remaining gap between those seats is under
the 40x40px touch floor `src/ui/CLAUDE.md` requires, and the arc cannot grow
without pushing a button off a phone-width viewport.

The primary seat is also the right home on its merits: it is the largest and
best-placed target in the cluster, which is what a press the player will make
every second or two wants. It already carried "smart" behavior (acquire-nearest
on a bare tap), so the assist is an extension of what that button meant rather
than a new idiom.

## Where the pieces live

| Piece | File |
|---|---|
| The authored priority list per class, and the condition vocabulary | `src/sim/content/rotations.ts` |
| The evaluator (which ability, right now) | `src/ui/hud/action_bar/assist_rotation_core.ts` |
| The four tap meanings | `src/ui/hud/action_bar/assist_tap_core.ts` |
| The timer-fired long-press binding (`TouchHoldSpec`) | `src/ui/touch_tap.ts` |
| The global cooldown tax | `src/sim/combat/assist_gcd.ts` |
| The taxed cast seam | `src/world_api/combat.ts`, `src/sim/sim.ts`, `src/net/online.ts`, `server/game.ts` |
| The primary-seat presentation flag | `src/ui/hud/action_bar/mobile_action_ring_painter.ts` |
| The wiring (descriptor slot 0, the tap, the per-frame resolve) | `src/ui/hud.ts` |
| The setting | `src/game/settings.ts`, `src/ui/options_view.ts` |

The priority data lives beside `classes.ts` on purpose: it is authored against
the class kits and has to change when a kit does, so it should be the sibling
file a kit editor sees. Nothing in `src/sim/` reads it, so `data.ts` does not
spread it; it is host-agnostic data any host could read.

## The rules the tables follow

Every rule below is a failing assertion in `tests/rotations_content.test.ts`, not
a convention:

1. Every entry names a real ability in the owning class's kit.
2. Nothing a single tap cannot make: no passive, no `targetMode: 'position'`
   (needs an aim point), no `empowerStages` (needs a hold), no
   `requiresDodgeProc` (the proc window is not mirrored to clients), no
   `requiresShield`.
3. **The assist never makes a judgement call.** No crowd control, no defensive
   cooldown, no heal, no resurrection, no summon, no taunt, no form or stance
   toggle, no aura or seal swap. It does the damage rotation and its upkeep;
   everything a player banks for a moment stays theirs. A control effect is
   allowed only as a rider on a press whose point is damage (Glacial Spike's
   root), and never one that breaks on damage.
4. Upkeep entries carry the matching `missing*` / `needsTargetDebuff` gate, so a
   buff or DoT is re-applied rather than clipped.
5. Mutually exclusive families (weapon imbues, seals, aspects) gate on the aura
   KIND, not their own aura id, so two rungs can never flip-flop forever.
6. Every list ends with an unconditional filler, so the button always resolves.

## How the evaluator decides

`pickAssistAbility` walks the class list top-down and returns:

1. the FIRST entry that is fully castable (known, off cooldown or with a charge
   left, affordable or covered by a free-cast proc, in range, an enemy selected
   if it needs one, and every `when` condition true); else
2. the LAST entry that is merely STRUCTURALLY castable (known, right form,
   stealth satisfied, kill window open).

The second answer is why the button never goes blank mid-fight: the class filler
shows through, dimmed by the shared bar view when it is unaffordable or out of
range, which reads as "you need more rage" or "get closer" exactly as a manual
slot does.

Two deliberate non-gates:

- **The GCD.** During the global cooldown the button keeps showing what fires
  next and paints the shared GCD sweep, instead of blanking every second.
- **`Entity.inCombat`.** It is not mirrored to clients, so "engaged" is modelled
  as "a living hostile target is selected" (`hasHostileTarget`).

Spec is resolved for free: `abilitiesKnownAt` already filters the known list by
the chosen spec, so one list per class covers every spec (an arms warrior simply
never knows `red_harvest`). The one exception is a press two specs both know but
rank differently, which is what the `specIsAnyOf` gate is for: every mage knows
both Fireball and Frostbolt, and a committed frost mage wants the Frostbolt that
feeds Fingers of Frost.

## Fairness and authority

- **Server authority is unchanged.** A tap sends the ordinary `cast` command (with
  an `assist` marker, no new wire token) for an ability the player already knows,
  validated and resolved server-side exactly as if they had pressed that ability's
  own button. Nothing here can make a cast succeed that a manual press would not.
- **The evaluator draws no rng.** It is client presentation logic reading only
  state both worlds already mirror, so the offline `Sim` and the online
  `ClientWorld` reach the same verdict.
- **The one sim change is the tax**, and it is deterministic: a plain multiplier on
  the resolved GCD, no clock and no rng, so the same assisted cast arms the same
  cooldown on all three hosts. Manual casts are byte-identical to before, which is
  why the golden-trace parity gate stays green.
- **Not a graphics tier knob.** The assist is a player setting, never shed by a
  preset or the FPS governor, so it cannot hide or delay anything actionable.
- **It is not a damage buff for experts.** A priority list plays a clean baseline
  rotation; it does not react to anything a player at a keyboard cannot. What it
  removes is the page-cycling tax that only touch players pay, and the GCD tax
  above prices what perfect ordering is worth.

## Known limits (deliberate, and where to pick them up)

- **Overpower and Mongoose Bite are absent.** Their dodge-proc window
  (`Entity.overpowerUntil`) is wired to clients as `opUntil` but never decoded in
  `src/net/online.ts`, so the client cannot know whether the cast would land.
  Decoding it would also let the action bar dim those slots correctly, which is a
  parity change worth doing on its own rather than inside this feature.
- **No interrupts.** Spending Kick or Counterspell on the wrong cast is worse
  than not having them, and the choice needs a read of the target's cast that a
  priority list cannot make.
- **Single target.** The lists are single-target rotations; the AoE presses that
  are pure AoE (Blizzard, Rain of Fire, Volley) are ground-targeted and excluded
  by rule 2 anyway.
- **Healing is not automated at all**, so a healer spec's Assist button is a
  damage-rotation button. That is the scope, not an oversight.
- **Offensive cooldowns fire on cooldown**, gated only on having a living hostile
  target (Combustion, Icy Veins, Rapid Fire, Adrenaline Rush, Tiger's Fury). A
  player at a keyboard banks those for a big pull; the assist cannot tell a big
  pull from a trash mob, because nothing the client mirrors says so. Spending them
  is the lesser error: an unspent cooldown is worth nothing, and the alternative
  (never using them) would make the button strictly worse than the bar it stands
  in for. If a future wire ever carries an elite/boss marker for the target, this
  is the first rung set that should read it.
