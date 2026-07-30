/**
 * Approval queue reads and the approve/reject write.
 *
 * The invalidation assertion is the one that earns its place. Approving moves points, XP, possibly a
 * level and a streak, and it decrements the dashboard's pending count — so invalidating only the
 * approvals list leaves a parent looking at a dashboard that still says "3 waiting" after they cleared
 * all three. They would believe it.
 */

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        apiUrl: 'https://api.example.test/api/v1',
        clientPlatform: 'taskbuddy-android',
        clientVersion: '0.1.0',
      },
    },
  },
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

interface FakeCall {
  url: string;
  method: string;
  body?: string;
}

let calls: FakeCall[] = [];

function setup(body: unknown, status = 200) {
  calls = [];
  jest.resetModules();

  global.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({
      url: String(url),
      method: init.method ?? 'GET',
      body: init.body as string | undefined,
    });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as unknown as Response;
  }) as unknown as typeof fetch;

  /* eslint-disable @typescript-eslint/no-require-imports */
  return require('../approvalsApi') as typeof import('../approvalsApi');
}

const queuePayload = {
  success: true,
  data: {
    assignments: [
      {
        id: 'a1',
        status: 'completed',
        completedAt: '2026-07-29T09:00:00.000Z',
        task: { id: 't1', title: 'Dishes', pointsValue: 10, requiresPhotoEvidence: true },
        child: { id: 'c1', firstName: 'Ada', lastName: 'L' },
        evidence: [
          { id: 'e1', evidenceType: 'photo', fileUrl: 'https://signed.example/photo?sig=abc' },
        ],
      },
    ],
    pagination: { page: 1, limit: 20, total: 1, totalPages: 1, hasMore: false },
  },
};

describe('fetchPendingApprovals', () => {
  it('reads the pending queue', async () => {
    const approvals = setup(queuePayload);

    const result = await approvals.fetchPendingApprovals();

    expect(calls[0].url).toContain('/tasks/assignments/pending');
    expect(result.assignments[0].child.firstName).toBe('Ada');
    expect(result.assignments[0].evidence[0].fileUrl).toContain('sig=abc');
  });

  it('never caches, because the evidence URLs are presigned and expire', async () => {
    /**
     * Evidence is private on R2 (F-4) and signed per request. Serving a cached payload means the
     * photos 403 while the data around them still looks fresh — "the queue sometimes shows broken
     * images", which is near-impossible to reproduce deliberately.
     */
    const approvals = setup(queuePayload);

    expect(approvals.approvalsQuery().staleTime).toBe(0);
  });
});

describe('decideApproval', () => {
  const resultPayload = {
    success: true,
    data: {
      assignment: { id: 'a1', status: 'approved' },
      pointsAwarded: 15,
      newBalance: 115,
      newLevel: 4,
      streakUpdated: { currentStreak: 5, isNewRecord: true },
    },
  };

  it('approves with a PUT and returns what the award actually was', async () => {
    const approvals = setup(resultPayload);

    const result = await approvals.decideApproval({ assignmentId: 'a1', approved: true });

    expect(calls[0].method).toBe('PUT');
    expect(calls[0].url).toContain('/tasks/assignments/a1/approve');
    expect(result.pointsAwarded).toBe(15);
    expect(result.streakUpdated?.isNewRecord).toBe(true);
  });

  it('omits rejectionReason when approving', async () => {
    // The field is only meaningful on a rejection; sending it on an approve is noise the server has to
    // reason about.
    const approvals = setup(resultPayload);

    await approvals.decideApproval({ assignmentId: 'a1', approved: true });

    expect(JSON.parse(calls[0].body as string)).toEqual({ approved: true });
  });

  it('sends the reason when rejecting', async () => {
    const approvals = setup(resultPayload);

    await approvals.decideApproval({
      assignmentId: 'a1',
      approved: false,
      rejectionReason: 'Bin is still full',
    });

    expect(JSON.parse(calls[0].body as string)).toEqual({
      approved: false,
      rejectionReason: 'Bin is still full',
    });
  });

  it('surfaces a conflict rather than pretending it worked', async () => {
    // /approve only matches a `completed` assignment, so a second tap on a row someone else already
    // handled is a 409. The UI must say so, not silently drop the row.
    const approvals = setup(
      { success: false, error: { message: 'Assignment is not awaiting approval' } },
      409
    );

    await expect(
      approvals.decideApproval({ assignmentId: 'a1', approved: true })
    ).rejects.toMatchObject({ name: 'ApiError', status: 409 });
  });
});

describe('invalidation set', () => {
  it('covers the dashboard and the task list, not just the queue', async () => {
    const approvals = setup(queuePayload);

    const keys = approvals.INVALIDATED_BY_APPROVAL.map((k) => JSON.stringify(k));

    expect(keys).toContain(JSON.stringify(approvals.APPROVALS_KEY));
    // The dashboard's pending count and its weekly stats both move on an approval.
    expect(keys).toContain(JSON.stringify(['dashboard', 'parent']));
    // The task list shows per-assignment status.
    expect(keys).toContain(JSON.stringify(['tasks']));
  });
});
