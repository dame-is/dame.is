import ReferenceCard from '../ReferenceCard.jsx';

/**
 * Renders a `pub.leaflet.poll.vote` record. The payload carries the
 * chosen option (or option index) plus a `subject` reference to the
 * poll itself. We render the chosen option as a lead-in and delegate
 * the poll preview to `ReferenceCard` (which already knows how to show
 * arbitrary atproto records as subject previews).
 */
export default function VoteCard(props) {
  const { payload } = props;
  const choice =
    payload?.option ||
    payload?.optionLabel ||
    payload?.choice ||
    (typeof payload?.optionIndex === 'number' ? `option ${payload.optionIndex + 1}` : null);

  return (
    <div className="vote-card-wrap">
      {choice && (
        <p className="vote-card-choice gutter small-caps">chose: {choice}</p>
      )}
      <ReferenceCard {...props} />
    </div>
  );
}
