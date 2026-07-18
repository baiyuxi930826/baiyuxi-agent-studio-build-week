'use client';

/**
 * F054: Story Export Page
 *
 * Renders story cards using the same visual style as real ChatMessage bubbles.
 * Designed for screenshots / long-image export.
 *
 * Usage: /story-export
 */

import { useState } from 'react';
import { MarkdownContent } from '@/components/MarkdownContent';
import { hexToRgba } from '@/lib/color-utils';
import { AGENT_STYLES, STORY_CARDS, type StoryCard as StoryCardType, type StoryMessage } from './story-data';

function StoryBubble({ msg }: { msg: StoryMessage }) {
  const style = AGENT_STYLES[msg.speaker];
  const isUser = msg.speaker === 'user';
  const [thinkingExpanded, setThinkingExpanded] = useState(true); // default expanded for export

  const bubbleClasses = isUser
    ? `rounded-2xl rounded-br-sm ${msg.isWhisper ? 'bg-conn-amber-bg text-conn-amber-text border border-dashed border-conn-amber-ring' : 'bg-[var(--semantic-warning-surface)] text-conn-amber-text'}`
    : `${style.bubbleRadius} ${style.font ?? ''} border`;

  const bubbleStyle = isUser
    ? undefined
    : { backgroundColor: style.secondary, borderColor: hexToRgba(style.primary, 0.3) };

  const nameLabel = msg.displayName ?? style.displayName;

  return (
    <div className={`flex gap-2 mb-4 items-start ${isUser ? 'flex-row-reverse' : ''}`}>
      {/* Avatar */}
      <div
        className="rounded-full ring-2 overflow-hidden flex-shrink-0 bg-studio-surface-elevated flex items-center justify-center"
        style={{
          width: 32,
          height: 32,
          ['--tw-ring-color' as string]: style.primary,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={style.avatar} alt={nameLabel} width={32} height={32} className="object-cover w-full h-full" />
      </div>

      {/* Bubble */}
      <div className="max-w-[80%] min-w-0">
        {/* Name + badge */}
        <div className={`mb-1 flex items-center gap-2 ${isUser ? 'flex-row-reverse' : ''}`}>
          {isUser && msg.badge && <BadgeTag badge={msg.badge} />}
          <span className="text-xs font-semibold" style={{ color: isUser ? undefined : style.primary, opacity: 0.8 }}>
            {nameLabel}
          </span>
          {!isUser && msg.badge && <BadgeTag badge={msg.badge} />}
        </div>

        <div className={`px-4 py-3 ${bubbleClasses}`} style={bubbleStyle}>
          {/* Thinking / inner monologue */}
          {msg.thinking && (
            <div className="mb-1">
              <button
                onClick={() => setThinkingExpanded((v) => !v)}
                className="flex items-center gap-1.5 text-xs text-studio-secondary hover:text-studio-secondary transition-colors mb-1"
              >
                <span
                  className="text-micro"
                  style={{
                    transform: thinkingExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                    display: 'inline-block',
                    transition: 'transform 0.15s',
                  }}
                >
                  &#9654;
                </span>
                <span>分析记录</span>
              </button>
              {thinkingExpanded && (
                <div className="border-l-2 border-studio pl-3 opacity-80">
                  <MarkdownContent content={msg.thinking} className={style.font} />
                </div>
              )}
            </div>
          )}
          {/* Main content */}
          {msg.content && <MarkdownContent content={msg.content} className={style.font} />}
        </div>

        {/* Annotation */}
        {msg.annotation && (
          <div className={`mt-1 text-xs text-studio-muted ${isUser ? 'text-right' : ''}`}>{msg.annotation}</div>
        )}
        {/* Reaction row */}
        {msg.reactions && (
          <div className={`mt-1 flex gap-1 ${isUser ? 'justify-end' : ''}`}>
            {msg.reactions.map((r, ri) => (
              <span key={ri} className="text-xs bg-studio-surface-elevated rounded-full px-1.5 py-0.5">
                {r}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function BadgeTag({ badge }: { badge: NonNullable<StoryMessage['badge']> }) {
  const colorMap = {
    red: 'bg-conn-red-bg text-conn-red-text',
    green: 'bg-conn-green-bg text-conn-green-text',
    amber: 'bg-[var(--semantic-warning-surface)] text-conn-amber-text',
    blue: 'bg-conn-blue-bg text-conn-blue-text',
  };
  return <span className={`text-micro px-1.5 py-0.5 rounded font-medium ${colorMap[badge.color]}`}>{badge.text}</span>;
}

function StoryCardView({ card, index }: { card: StoryCardType; index: number }) {
  return (
    <div className="mb-8">
      {/* Card divider / header */}
      <div className="mb-6 text-center">
        <div className="text-xs text-studio-muted mb-1">#{index + 1}</div>
        <h2 className="text-xl font-bold text-studio">{card.title}</h2>
        {card.subtitle && <p className="text-sm text-studio-secondary mt-1">{card.subtitle}</p>}
        <div className="mt-3 mx-auto w-16 h-0.5 bg-studio-surface rounded-full" />
      </div>

      {/* Messages */}
      <div className="space-y-0">
        {card.messages.map((msg, i) => (
          <StoryBubble key={i} msg={msg} />
        ))}
      </div>
    </div>
  );
}

export default function StoryExportPage() {
  return (
    <div className="min-h-screen bg-studio-surface-elevated">
      {/* Header */}
      <div className="bg-studio-surface border-b border-studio py-6 text-center">
        <h1 className="text-2xl font-bold text-studio">能力通道协作案例</h1>
        <p className="text-sm text-studio-secondary mt-1">Baiyuxi Agent Studio 的角色协作与复盘导出</p>
        <p className="text-xs text-studio-muted mt-2">计划、审查、设计、交付</p>
      </div>

      {/* Cards */}
      <div className="max-w-lg mx-auto px-4 py-8">
        {STORY_CARDS.map((card, i) => (
          <StoryCardView key={i} card={card} index={i} />
        ))}

        {/* Footer */}
        <div className="text-center py-8 border-t border-studio mt-4">
          <p className="text-sm text-studio-secondary">Baiyuxi Agent Studio</p>
          <p className="text-xs text-studio-muted mt-1">个人 Agent 能力工作台</p>
        </div>
      </div>
    </div>
  );
}
