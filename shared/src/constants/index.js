"use strict";
// Shared constants
Object.defineProperty(exports, "__esModule", { value: true });
exports.AGE_GROUPS = exports.NOTIFICATION_TYPES = exports.DEFAULT_CATEGORIES = exports.UPLOAD = exports.RATE_LIMITS = exports.VALIDATION = exports.GAMIFICATION = void 0;
exports.getAgeGroup = getAgeGroup;
// Gamification constants
exports.GAMIFICATION = {
    // Level progression: XP = BASE_XP * level^GROWTH_FACTOR
    LEVEL: {
        BASE_XP: 100,
        GROWTH_FACTOR: 1.5,
        MAX_LEVEL: 100,
    },
    // Streak bonuses
    STREAK: {
        MULTIPLIER: 0.05, // 5% bonus per streak day
        MAX_BONUS: 2.5, // 150% max bonus
        MILESTONES: [3, 7, 14, 30, 60, 100],
        MILESTONE_BONUS_PER_DAY: 5, // 5 points per milestone day
        DEFAULT_GRACE_PERIOD_HOURS: 4,
    },
    // Early completion bonuses
    EARLY_COMPLETION: {
        HOURS_48: 0.25, // 25% bonus
        HOURS_24: 0.15, // 15% bonus
        HOURS_12: 0.10, // 10% bonus
        HOURS_6: 0.05, // 5% bonus
    },
    // Task XP values by difficulty
    TASK_XP: {
        easy: 10,
        medium: 20,
        hard: 35,
    },
    // Default points by difficulty
    DEFAULT_POINTS: {
        easy: 10,
        medium: 20,
        hard: 35,
    },
};
// Validation constants
exports.VALIDATION = {
    PIN: {
        LENGTH: 4,
        PATTERN: /^\d{4}$/,
    },
    PASSWORD: {
        MIN_LENGTH: 8,
        CHILD_MIN_LENGTH: 6,
    },
    USERNAME: {
        MIN_LENGTH: 3,
        MAX_LENGTH: 20,
        PATTERN: /^[a-zA-Z0-9_]+$/,
    },
    TASK_TITLE: {
        MIN_LENGTH: 3,
        MAX_LENGTH: 200,
    },
    POINTS: {
        MIN: 1,
        MAX: 1000,
    },
};
// Rate limiting
exports.RATE_LIMITS = {
    API: {
        WINDOW_MS: 15 * 60 * 1000, // 15 minutes
        MAX_REQUESTS: 100,
    },
    AUTH: {
        WINDOW_MS: 15 * 60 * 1000,
        MAX_REQUESTS: 5,
    },
    UPLOAD: {
        WINDOW_MS: 60 * 1000, // 1 minute
        MAX_REQUESTS: 10,
    },
};
// Upload limits
exports.UPLOAD = {
    MAX_FILE_SIZE_BYTES: 10 * 1024 * 1024, // 10MB
    MAX_COMPRESSED_SIZE_BYTES: 2 * 1024 * 1024, // 2MB
    MAX_DIMENSION: 2048,
    THUMBNAIL_SIZE: 300,
    ALLOWED_MIME_TYPES: [
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/heic',
        'image/heif',
    ],
};
// Task categories (default, families can customize)
exports.DEFAULT_CATEGORIES = [
    'cleaning',
    'homework',
    'outdoor',
    'cooking',
    'pet-care',
    'personal-care',
    'helping',
    'other',
];
// Notification types
exports.NOTIFICATION_TYPES = {
    TASK_ASSIGNED: 'task_assigned',
    TASK_DUE_SOON: 'task_due_soon',
    TASK_COMPLETED: 'task_completed',
    TASK_APPROVED: 'task_approved',
    TASK_REJECTED: 'task_rejected',
    POINTS_EARNED: 'points_earned',
    REWARD_REDEEMED: 'reward_redeemed',
    ACHIEVEMENT_UNLOCKED: 'achievement_unlocked',
    LEVEL_UP: 'level_up',
    STREAK_AT_RISK: 'streak_at_risk',
    STREAK_BROKEN: 'streak_broken',
    SECURITY_ALERT: 'security_alert',
};
// Age groups
exports.AGE_GROUPS = {
    YOUNGER: '10-12',
    OLDER: '13-16',
};
function getAgeGroup(birthDate) {
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        age--;
    }
    if (age >= 10 && age <= 12)
        return '10-12';
    if (age >= 13 && age <= 16)
        return '13-16';
    return null;
}
//# sourceMappingURL=index.js.map