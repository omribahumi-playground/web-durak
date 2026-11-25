import React from 'react';

interface RulesModalProps {
  onClose: () => void;
}

export const RulesModal: React.FC<RulesModalProps> = ({ onClose }) => {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card rules-card" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <h2>How to Play Durak</h2>
          <button type="button" className="btn btn-ghost btn-xs" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="rules-body">
          <p>
            <strong>Objective:</strong> Empty your hand once the draw deck runs out.
            The <em>last</em> player left holding cards loses the round as the <strong>Durak</strong>!
          </p>

          <h3>Setup &amp; Trump</h3>
          <ul>
            <li>Choose a deck size in the lobby: <strong>24 cards</strong> (9–A), <strong>36 cards</strong> (6–A, standard), or <strong>52 cards</strong> (2–A).</li>
            <li>Each of the 2–4 players is dealt <strong>6 cards</strong>.</li>
            <li>The bottom card of the deck is flipped face-up to set the <strong>Trump suit</strong> (★). If all 24 cards are dealt to 4 players, the last card dealt reveals trump.</li>
            <li>The player holding the lowest trump card attacks first.</li>
          </ul>

          <h3>Attacking &amp; Defending</h3>
          <ul>
            <li>The <strong>Attacker</strong> plays any card against the <strong>Defender</strong> (next player clockwise).</li>
            <li>To beat an attack, the Defender must play a <strong>higher card of the same suit</strong>, or any <strong>Trump card</strong> (a trump attack can only be beaten by a higher trump).</li>
            <li><strong>Throw-in Attacks:</strong> Any non-defending player may throw in extra cards whose <strong>rank</strong> matches any card already on the table (up to 6 cards total, or 5 on the very first bout, and never more than the Defender&apos;s starting hand).</li>
            <li><strong>Passing Mode (Optional):</strong> Before defending any card, the Defender may play a card of the same rank to pass the entire attack clockwise to the next player (if they have enough cards to cover).</li>
          </ul>

          <h3>Ending a Bout</h3>
          <ul>
            <li><strong>Discard (Defended):</strong> If all attacks are beaten and attackers pass, table cards are discarded and the Defender becomes the next Attacker.</li>
            <li><strong>Take:</strong> If the Defender cannot (or chooses not to) defend, they pick up all cards on the table (attackers may throw in matching ranks first) and skip their attack turn.</li>
            <li>After each bout, players refill up to 6 cards from the deck — Main Attacker first, Defender last.</li>
          </ul>
        </div>

        <div className="modal-actions">
          <button type="button" className="btn btn-gold" onClick={onClose}>
            Got It
          </button>
        </div>
      </div>
    </div>
  );
};
