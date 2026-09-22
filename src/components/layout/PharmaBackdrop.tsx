export function PharmaBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 72% 38% at 5% 16%, rgba(174,229,197,0.58) 0%, rgba(224,245,232,0) 72%)," +
            "radial-gradient(ellipse 58% 42% at 96% 48%, rgba(239,218,169,0.42) 0%, rgba(250,245,233,0) 74%)," +
            "radial-gradient(ellipse 64% 36% at 12% 92%, rgba(198,225,217,0.42) 0%, rgba(236,247,242,0) 72%)," +
            "linear-gradient(180deg, #edf7f0 0%, #f8fbf9 34%, #f1f7f2 68%, #f8fbf9 100%)",
        }}
      />
    </div>
  );
}
