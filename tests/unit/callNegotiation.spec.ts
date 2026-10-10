import { describe, expect, it } from 'vitest';
import {
  canRollbackLocalDescription,
  createPeerNegotiationFlags,
  decideIncomingDescription,
  decideIncomingOffer,
  resolveNegotiationRole,
  shouldDropIceCandidate,
  simulateApplyRemoteDescription,
  simulateCreateOffer,
  simulateReceiveIce,
  type SimulatedPeer
} from '../../src/messages/callNegotiation';
import {
  CALL_MEDIA_ORDER,
  createCallOpTracker,
  nextLifecyclePhase,
  shouldReleaseMediaOnFailure
} from '../../src/messages/callMediaLifecycle';

const makePeer = (id: string, remoteId: string): SimulatedPeer => ({
  id,
  role: resolveNegotiationRole(id, remoteId),
  flags: createPeerNegotiationFlags(),
  signalingState: 'stable',
  localDescription: null,
  remoteDescription: null,
  queuedIce: [],
  appliedIce: [],
  droppedIce: []
});

describe('callNegotiation perfect negotiation', () => {
  it('assigns deterministic polite/impolite roles from user ids', () => {
    expect(resolveNegotiationRole('user-a', 'user-b')).toBe('impolite');
    expect(resolveNegotiationRole('user-b', 'user-a')).toBe('polite');
    const ab = resolveNegotiationRole('aaa', 'zzz');
    const ba = resolveNegotiationRole('zzz', 'aaa');
    expect(ab).not.toBe(ba);
  });

  it('does not make both peers impolite on equal ids', () => {
    expect(resolveNegotiationRole('same', 'same')).toBe('polite');
  });

  it('accepts offer when stable and not making offer', () => {
    expect(
      decideIncomingOffer({ signalingState: 'stable', makingOffer: false, isPolite: false })
    ).toEqual({ action: 'accept' });
  });

  it('impolite peer ignores glare offer but answer decision is always accept', () => {
    expect(
      decideIncomingOffer({
        signalingState: 'have-local-offer',
        makingOffer: true,
        isPolite: false
      })
    ).toEqual({ action: 'ignore' });
    // Critical R-01: answers are never ignored.
    expect(
      decideIncomingDescription({
        descriptionType: 'answer',
        signalingState: 'have-local-offer',
        makingOffer: true,
        isPolite: false,
        isSettingRemoteAnswerPending: false
      })
    ).toEqual({ action: 'accept' });
  });

  it('polite peer rolls back and accepts on collision', () => {
    expect(
      decideIncomingOffer({
        signalingState: 'have-local-offer',
        makingOffer: true,
        isPolite: true
      })
    ).toEqual({ action: 'rollback_and_accept' });
  });

  it('detects rollback-capable signaling states', () => {
    expect(canRollbackLocalDescription({ signalingState: 'have-local-offer' })).toBe(true);
    expect(canRollbackLocalDescription({ signalingState: 'stable' })).toBe(false);
  });

  /**
   * R-01 regression: simultaneous offers must still complete negotiation.
   * 1. Both create offers
   * 2. Impolite ignores remote offer
   * 3. Polite rolls back, applies impolite offer, creates answer
   * 4. Impolite applies that answer (must NOT drop it)
   */
  it('glare: impolite applies polite answer after ignoring remote offer', () => {
    const impolite = makePeer('user-a', 'user-b'); // a < b → impolite
    const polite = makePeer('user-b', 'user-a'); // polite

    expect(impolite.role).toBe('impolite');
    expect(polite.role).toBe('polite');

    const offerI = simulateCreateOffer(impolite);
    const offerP = simulateCreateOffer(polite);

    // Impolite receives polite offer while have-local-offer → ignore
    const ignoreResult = simulateApplyRemoteDescription(impolite, offerP);
    expect(ignoreResult.applied).toBe(false);
    expect(ignoreResult.decision.action).toBe('ignore');
    expect(impolite.flags.ignoreOffer).toBe(true);
    expect(impolite.remoteDescription).toBeNull();

    // Polite receives impolite offer → rollback + accept + answer
    const politeApply = simulateApplyRemoteDescription(polite, offerI);
    expect(politeApply.applied).toBe(true);
    expect(politeApply.decision.action).toBe('rollback_and_accept');
    expect(polite.localDescription?.type).toBe('answer');
    expect(polite.remoteDescription?.sdp).toBe(offerI.sdp);

    // Impolite receives polite's answer — must apply despite ignoreOffer history
    const answer = polite.localDescription!;
    const impoliteAnswer = simulateApplyRemoteDescription(impolite, answer);
    expect(impoliteAnswer.applied).toBe(true);
    expect(impolite.remoteDescription?.type).toBe('answer');
    expect(impolite.signalingState).toBe('stable');
    expect(impolite.flags.ignoreOffer).toBe(false);
  });

  it('drops ICE for ignored offer; queues then applies ICE for valid path', () => {
    const peer = makePeer('user-a', 'user-b');
    simulateCreateOffer(peer);
    peer.flags.ignoreOffer = true;
    simulateReceiveIce(peer, 'ice-ignored');
    expect(peer.droppedIce).toContain('ice-ignored');
    expect(shouldDropIceCandidate(peer.flags)).toBe(true);

    peer.flags.ignoreOffer = false;
    simulateReceiveIce(peer, 'ice-queued');
    expect(peer.queuedIce).toContain('ice-queued');

    // Apply answer and flush
    simulateApplyRemoteDescription(peer, { type: 'answer', sdp: 'ans' });
    expect(peer.appliedIce).toContain('ice-queued');
  });

  it('supports repeated glare recovery', () => {
    const impolite = makePeer('a', 'z');
    const polite = makePeer('z', 'a');
    for (let i = 0; i < 3; i += 1) {
      const oi = simulateCreateOffer(impolite);
      const op = simulateCreateOffer(polite);
      simulateApplyRemoteDescription(impolite, op);
      simulateApplyRemoteDescription(polite, oi);
      const ans = polite.localDescription!;
      const applied = simulateApplyRemoteDescription(impolite, ans);
      expect(applied.applied).toBe(true);
      // reset for next cycle
      impolite.localDescription = null;
      polite.localDescription = null;
      impolite.remoteDescription = null;
      polite.remoteDescription = null;
      impolite.signalingState = 'stable';
      polite.signalingState = 'stable';
    }
  });
});

describe('callMediaLifecycle', () => {
  it('documents authorize-before-media order', () => {
    expect(CALL_MEDIA_ORDER[0]).toBe('authorize');
    expect(CALL_MEDIA_ORDER[1]).toBe('acquire_media');
  });

  it('transitions authorize → acquire → join → active', () => {
    let phase = nextLifecyclePhase('idle', 'begin_authorize');
    expect(phase).toBe('authorizing');
    phase = nextLifecyclePhase(phase, 'authorize_ok');
    expect(phase).toBe('acquiring_media');
    phase = nextLifecyclePhase(phase, 'media_ok');
    expect(phase).toBe('joining');
    phase = nextLifecyclePhase(phase, 'join_ok');
    expect(phase).toBe('active');
  });

  it('fails and requires cleanup on permission denial / timeout / reject', () => {
    expect(nextLifecyclePhase('acquiring_media', 'media_fail')).toBe('failed');
    expect(shouldReleaseMediaOnFailure('permission_denial')).toBe(true);
    expect(shouldReleaseMediaOnFailure('timeout')).toBe(true);
    expect(shouldReleaseMediaOnFailure('reject')).toBe(true);
    expect(shouldReleaseMediaOnFailure('signaling_failure')).toBe(true);
    expect(shouldReleaseMediaOnFailure('network_loss')).toBe(true);
    expect(shouldReleaseMediaOnFailure('cancel')).toBe(true);
  });

  it('supports repeated attempt state reset via end', () => {
    expect(nextLifecyclePhase('failed', 'end')).toBe('ended');
    expect(nextLifecyclePhase('active', 'end')).toBe('ended');
  });
});

describe('R-04 call op tracker', () => {
  it('invalidates prior token when start B begins', () => {
    const tracker = createCallOpTracker();
    const tokenA = tracker.begin();
    expect(tracker.isCurrent(tokenA)).toBe(true);
    const tokenB = tracker.begin();
    expect(tracker.isCurrent(tokenA)).toBe(false);
    expect(tracker.isCurrent(tokenB)).toBe(true);
  });

  it('bindCallId then newer begin makes old call stale', () => {
    const tracker = createCallOpTracker();
    const tokenA = tracker.begin();
    tracker.bindCallId(tokenA, 'call-a');
    expect(tracker.isCurrent(tokenA)).toBe(true);
    const tokenB = tracker.begin('call-b');
    expect(tracker.isCurrent(tokenA)).toBe(false);
    expect(tracker.isCurrent(tokenB)).toBe(true);
  });

  it('end/unmount invalidate leaves no current token', () => {
    const tracker = createCallOpTracker();
    const token = tracker.begin('call-1');
    tracker.invalidate();
    expect(tracker.isCurrent(token)).toBe(false);
  });

  it('accept then end: permission late result is stale', () => {
    const tracker = createCallOpTracker();
    const acceptToken = tracker.begin('call-x');
    expect(tracker.isCurrent(acceptToken)).toBe(true);
    // user ends while permission pending
    tracker.invalidate();
    expect(tracker.isCurrent(acceptToken)).toBe(false);
  });

  it('repeated start clicks only last generation is current', () => {
    const tracker = createCallOpTracker();
    const tokens = [tracker.begin(), tracker.begin(), tracker.begin()];
    expect(tracker.isCurrent(tokens[0])).toBe(false);
    expect(tracker.isCurrent(tokens[1])).toBe(false);
    expect(tracker.isCurrent(tokens[2])).toBe(true);
  });
});
