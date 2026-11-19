// What every view of the hub shares: who is signed in and what they may do,
// the bot's lists and which one is shown, and the one way to run a command.
//
// A command is the bot's own (bluesky-mod's POST /api/command), so the veto
// and the decision log are the bot's. With several lists the bot may answer
// "Which list?" instead of acting; the hub asks the same question here, with
// the bot's own options, rather than guessing.

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from 'react';
import Button from '../Button.jsx';
import Modal from '../Modal.jsx';
import { runCommand } from '../../lib/moderation/client.js';

const HubCtx = createContext({
  me: null,
  multi: false,
  lists: [],
  list: null,
  setList: () => {},
  canWrite: false,
  isOwner: false,
});

export const useHub = () => useContext(HubCtx);

export function HubProvider({ value, children }) {
  return <HubCtx.Provider value={value}>{children}</HubCtx.Provider>;
}

const ChoiceCtx = createContext(null);

/**
 * `const run = useCommand(agent); const reply = await run('unblock did:…')`.
 * Resolves with the bot's reply once something was done, or null when a
 * "Which list?" was asked and nobody chose. Throws the bot's words when it
 * refused.
 */
export function useCommand(agent) {
  const ask = useContext(ChoiceCtx);
  return useCallback(
    async (text) => {
      const reply = await runCommand(agent, text);
      if (!reply.choice) return reply;
      const picked = await ask(reply);
      if (!picked) return null;
      let last = null;
      for (const command of picked.commands)
        last = await runCommand(agent, command);
      return last;
    },
    [agent, ask],
  );
}

/** Holds the "Which list?" dialog for every view under it. */
export function ChoiceHost({ children }) {
  const [asking, setAsking] = useState(null);
  const resolver = useRef(null);

  const ask = useCallback(
    (reply) =>
      new Promise((resolve) => {
        resolver.current = resolve;
        setAsking(reply);
      }),
    [],
  );

  const answer = (option) => {
    resolver.current?.(option);
    resolver.current = null;
    setAsking(null);
  };

  return (
    <ChoiceCtx.Provider value={ask}>
      {children}
      <Modal
        open={Boolean(asking)}
        onClose={() => answer(null)}
        label="Which list?"
        className="mh-choice"
      >
        {asking && (
          <div className="mh-choice-body">
            <p className="mh-choice-text">{asking.text}</p>
            <div className="mh-choice-options">
              {asking.options.map((o) => (
                <Button key={o.label} onClick={() => answer(o)}>
                  {o.label}
                </Button>
              ))}
              <Button variant="text" onClick={() => answer(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </ChoiceCtx.Provider>
  );
}
