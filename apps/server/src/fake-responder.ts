export type FakeResponderVisitorMessage = {
  body: string;
};

export type FakeResponderInput = {
  visitorMessage: FakeResponderVisitorMessage;
};

export type FakeResponderReply = {
  body: string;
};

const FAKE_RESPONDER_REPLY_BODY =
  'Thanks for trying the local Panda chat widget demo. This is a fake V1 reply, but your message was received.';

export function createFakeResponderReply(_input: FakeResponderInput): FakeResponderReply {
  return { body: FAKE_RESPONDER_REPLY_BODY };
}
