/**
 * Demo: no ICE servers. Two tabs on one machine connect with local candidates only,
 * and no public IP address is shared with any STUN server.
 *
 * Production (once the TURN relay exists), set something like:
 *   iceServers: [{ urls: 'turns:turn.example.com:443', username, credential }],
 *   iceTransportPolicy: 'relay',   // never reveal either person's IP to the other
 * Credentials should be short-lived and issued by the backend.
 */
export const RTC_CONFIG: RTCConfiguration = {
  iceServers: [],
};
