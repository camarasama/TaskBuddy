/**
 * TaskCommentThread — the FR-11 comment thread for one task assignment.
 *
 * Loads the thread on mount, posts new comments, and listens for the `task:comment` socket event so
 * the other participant's messages appear live. Access is enforced server-side (family parents, or
 * the child who owns the assignment); this component just renders whatever it's allowed to see.
 *
 * ## Rewritten deliberately, and why every effect here looks the way it does
 *
 * This component was present in every occurrence of `TypeError: i is not a function` — a crash
 * thrown from React's `commitHookEffectListUnmount` when an effect's stored cleanup turned out not
 * to be a function. It killed the page whenever a subtree holding one of these threads was deleted:
 * pressing back off a task, or switching tabs after claiming one. The culprit line was never found,
 * so the component was rewritten to make that class of fault impossible here rather than to fix a
 * line nobody could point at.
 *
 * Three rules, all of which the previous version broke or came close to breaking:
 *
 *  1. **Every effect has a block body and an explicit cleanup or none.** The old scroll effect was
 *     `useEffect(scrollToEnd, [comments.length])` where `scrollToEnd` was a concise arrow — its
 *     return value became React's cleanup. That happened to be `undefined`, but it is one character
 *     away from not being, and it is unreadable as a cleanup contract.
 *  2. **Nothing async settles into state after unmount.** The load is guarded by a flag the cleanup
 *     flips, so a slow response cannot call `setState` on a torn-down tree.
 *  3. **The socket handler is registered and removed against the same captured reference**, with the
 *     removal wrapped so an already-disconnected socket cannot throw from inside a cleanup — a throw
 *     there is escalated by React to the nearest boundary and takes the page down.
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Send, MessageSquare } from 'lucide-react';
import type { TaskComment } from '@taskbuddy/shared';
import { tasksApi, ApiError } from '@/lib/api';
import { useSocket } from '@/contexts/SocketContext';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';

function authorName(c: TaskComment): string {
  return c.author ? `${c.author.firstName} ${c.author.lastName}`.trim() : 'Someone';
}

export function TaskCommentThread({ assignmentId }: { assignmentId: string }) {
  const { error: showError } = useToast();
  const { socket } = useSocket();
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const addComment = useCallback((incoming: TaskComment) => {
    setComments((prev) => (prev.some((c) => c.id === incoming.id) ? prev : [...prev, incoming]));
  }, []);

  // Load the thread. `live` is flipped by the cleanup so a response that arrives after this card has
  // been deleted is dropped instead of setting state on a torn-down tree.
  useEffect(() => {
    let live = true;

    tasksApi
      .getComments(assignmentId)
      .then((res) => {
        if (!live) return;
        setComments(res.data?.comments ?? []);
      })
      .catch(() => {
        // A 403/404 just means there is no thread to show here; stay quiet.
      })
      .finally(() => {
        if (live) setLoading(false);
      });

    return () => {
      live = false;
    };
  }, [assignmentId]);

  // Live updates: append any task:comment for THIS assignment we did not already add locally.
  useEffect(() => {
    if (!socket) return;

    const onComment = (payload: { assignmentId: string; comment: TaskComment }) => {
      if (payload?.assignmentId !== assignmentId) return;
      addComment(payload.comment);
    };

    socket.on('task:comment', onComment);

    return () => {
      // Guarded: the provider disconnects on every navigation, and a throw inside a cleanup is
      // escalated by React to the nearest error boundary — it would take the whole page down.
      try {
        socket.off('task:comment', onComment);
      } catch {
        // Nothing to do: the listener dies with the socket either way.
      }
    };
  }, [socket, assignmentId, addComment]);

  // Keep the newest message in view. No cleanup, stated explicitly rather than implied by an
  // expression body whose value would silently become React's cleanup.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [comments.length]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const content = draft.trim();
    if (!content || sending) return;

    setSending(true);
    try {
      const res = await tasksApi.addComment(assignmentId, content);
      const created = res.data?.comment;
      // Added optimistically; the socket handler de-dupes by id if it also arrives.
      if (created) addComment(created);
      setDraft('');
    } catch (err) {
      showError(err instanceof ApiError ? err.message : 'Could not post your comment.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-center gap-2 mb-3 text-slate-700">
        <MessageSquare className="w-4 h-4" />
        <h4 className="text-sm font-semibold">Comments</h4>
      </div>

      <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
        {loading ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : comments.length === 0 ? (
          <p className="text-sm text-slate-400">No comments yet. Say something encouraging!</p>
        ) : (
          comments.map((c) => (
            <div key={c.id} className="text-sm">
              <span className="font-medium text-slate-800">{authorName(c)}</span>{' '}
              <span className="text-slate-400 text-xs">
                {new Date(c.createdAt).toLocaleString()}
              </span>
              <p className="text-slate-700 whitespace-pre-wrap break-words">{c.content}</p>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={send} className="mt-3 flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, 1000))}
          placeholder="Write a comment…"
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
        />
        <Button type="submit" size="sm" loading={sending} disabled={!draft.trim()}>
          <Send className="w-4 h-4" />
        </Button>
      </form>
    </div>
  );
}
