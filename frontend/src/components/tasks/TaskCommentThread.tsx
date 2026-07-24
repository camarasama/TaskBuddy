/**
 * TaskCommentThread — the FR-11 comment thread for one task assignment.
 *
 * Loads the thread on mount, posts new comments, and listens for the `task:comment` socket event so
 * the other participant's messages appear live. Access is enforced server-side (family parents, or
 * the child who owns the assignment); this component just renders whatever it's allowed to see.
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

  const scrollToEnd = () => endRef.current?.scrollIntoView({ behavior: 'smooth' });

  const load = useCallback(async () => {
    try {
      const res = await tasksApi.getComments(assignmentId);
      setComments(res.data?.comments ?? []);
    } catch {
      // A 403/404 just means no thread to show here; stay quiet.
    } finally {
      setLoading(false);
    }
  }, [assignmentId]);

  useEffect(() => {
    load();
  }, [load]);

  // Live updates: append any task:comment for THIS assignment we didn't already add locally.
  useEffect(() => {
    if (!socket) return;
    const onComment = (payload: { assignmentId: string; comment: TaskComment }) => {
      if (payload.assignmentId !== assignmentId) return;
      setComments((prev) =>
        prev.some((c) => c.id === payload.comment.id) ? prev : [...prev, payload.comment],
      );
    };
    socket.on('task:comment', onComment);
    return () => {
      socket.off('task:comment', onComment);
    };
  }, [socket, assignmentId]);

  useEffect(scrollToEnd, [comments.length]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    try {
      const res = await tasksApi.addComment(assignmentId, content);
      const created = res.data?.comment;
      if (created) {
        // Add optimistically; the socket handler de-dupes by id if it also arrives.
        setComments((prev) => (prev.some((c) => c.id === created.id) ? prev : [...prev, created]));
      }
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
