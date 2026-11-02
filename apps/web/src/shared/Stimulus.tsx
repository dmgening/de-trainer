import { useEffect, useState } from 'react';
import type { BankSnapshot, Stimulus } from '@de-trainer/core';
import { useBackend } from './backend';

function MediaImage({ bank, mediaId, alt }: { bank: BankSnapshot; mediaId: string; alt: string }) {
  const { mediaUrl } = useBackend();
  const media = bank.media.find((m) => m.media_id === mediaId);
  const [src, setSrc] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let url: string | null = null;
    let live = true;
    if (media) {
      void mediaUrl(media).then((u) => {
        url = u;
        if (live) setSrc(u);
        else if (u?.startsWith('blob:')) URL.revokeObjectURL(u);
      });
    }
    return () => {
      live = false;
      if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
    };
  }, [media, mediaUrl]);
  if (!media || src === null) return <p className="media-missing">Картинка недоступна. {alt}</p>;
  return (
    <figure className="stimulus-media">
      {src ? <img src={src} alt={alt} width={media.width} height={media.height} /> : <div className="media-placeholder" aria-hidden />}
    </figure>
  );
}

/** Context for the question: plain text, a passage or dialogue, an image. Always rendered as text, never as HTML. */
export function StimulusView({ stimulus, bank }: { stimulus?: Stimulus; bank: BankSnapshot }) {
  if (!stimulus) return null;
  return (
    <div className="stimulus">
      {stimulus.media && <MediaImage bank={bank} mediaId={stimulus.media.media_id} alt={stimulus.media.alt} />}
      {stimulus.passage && (
        <div className={`passage passage-${stimulus.passage.kind}`} lang="de">
          {stimulus.passage.title && <p className="passage-title">{stimulus.passage.title}</p>}
          {stimulus.passage.lines.map((l, i) => (
            <p key={i}>
              {l.speaker && <b>{l.speaker}: </b>}
              {l.text}
            </p>
          ))}
        </div>
      )}
      {stimulus.text && (
        <p className="stimulus-text" lang="de">
          {stimulus.text}
        </p>
      )}
    </div>
  );
}
