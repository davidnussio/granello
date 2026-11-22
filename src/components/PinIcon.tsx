/** La puntina dei meeting fissati: piena quando il meeting è fissato, solo il contorno se no. */
export default function PinIcon({ filled = false }: { filled?: boolean }) {
  return (
    <svg
      className="pin-icon"
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 3.5h6l-1 6 3.5 3.5v1.5h-11V13L10 9.5z" />
      <path d="M12 14.5V21" fill="none" />
    </svg>
  );
}
