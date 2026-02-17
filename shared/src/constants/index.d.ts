export declare const GAMIFICATION: {
    readonly LEVEL: {
        readonly BASE_XP: 100;
        readonly GROWTH_FACTOR: 1.5;
        readonly MAX_LEVEL: 100;
    };
    readonly STREAK: {
        readonly MULTIPLIER: 0.05;
        readonly MAX_BONUS: 2.5;
        readonly MILESTONES: readonly [3, 7, 14, 30, 60, 100];
        readonly MILESTONE_BONUS_PER_DAY: 5;
        readonly DEFAULT_GRACE_PERIOD_HOURS: 4;
    };
    readonly EARLY_COMPLETION: {
        readonly HOURS_48: 0.25;
        readonly HOURS_24: 0.15;
        readonly HOURS_12: 0.1;
        readonly HOURS_6: 0.05;
    };
    readonly TASK_XP: {
        readonly easy: 10;
        readonly medium: 20;
        readonly hard: 35;
    };
    readonly DEFAULT_POINTS: {
        readonly easy: 10;
        readonly medium: 20;
        readonly hard: 35;
    };
};
export declare const VALIDATION: {
    readonly PIN: {
        readonly LENGTH: 4;
        readonly PATTERN: RegExp;
    };
    readonly PASSWORD: {
        readonly MIN_LENGTH: 8;
        readonly CHILD_MIN_LENGTH: 6;
    };
    readonly USERNAME: {
        readonly MIN_LENGTH: 3;
        readonly MAX_LENGTH: 20;
        readonly PATTERN: RegExp;
    };
    readonly TASK_TITLE: {
        readonly MIN_LENGTH: 3;
        readonly MAX_LENGTH: 200;
    };
    readonly POINTS: {
        readonly MIN: 1;
        readonly MAX: 1000;
    };
};
export declare const RATE_LIMITS: {
    readonly API: {
        readonly WINDOW_MS: number;
        readonly MAX_REQUESTS: 100;
    };
    readonly AUTH: {
        readonly WINDOW_MS: number;
        readonly MAX_REQUESTS: 5;
    };
    readonly UPLOAD: {
        readonly WINDOW_MS: number;
        readonly MAX_REQUESTS: 10;
    };
};
export declare const UPLOAD: {
    readonly MAX_FILE_SIZE_BYTES: number;
    readonly MAX_COMPRESSED_SIZE_BYTES: number;
    readonly MAX_DIMENSION: 2048;
    readonly THUMBNAIL_SIZE: 300;
    readonly ALLOWED_MIME_TYPES: readonly ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
};
export declare const DEFAULT_CATEGORIES: readonly ["cleaning", "homework", "outdoor", "cooking", "pet-care", "personal-care", "helping", "other"];
export declare const NOTIFICATION_TYPES: {
    readonly TASK_ASSIGNED: "task_assigned";
    readonly TASK_DUE_SOON: "task_due_soon";
    readonly TASK_COMPLETED: "task_completed";
    readonly TASK_APPROVED: "task_approved";
    readonly TASK_REJECTED: "task_rejected";
    readonly POINTS_EARNED: "points_earned";
    readonly REWARD_REDEEMED: "reward_redeemed";
    readonly ACHIEVEMENT_UNLOCKED: "achievement_unlocked";
    readonly LEVEL_UP: "level_up";
    readonly STREAK_AT_RISK: "streak_at_risk";
    readonly STREAK_BROKEN: "streak_broken";
    readonly SECURITY_ALERT: "security_alert";
};
export declare const AGE_GROUPS: {
    readonly YOUNGER: "10-12";
    readonly OLDER: "13-16";
};
export declare function getAgeGroup(birthDate: Date): '10-12' | '13-16' | null;
//# sourceMappingURL=index.d.ts.map