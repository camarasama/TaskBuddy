/**
 * emails/rewardRedeemed.ts — M9
 * Sent to ALL parents when a child redeems a reward.
 * triggerType: 'reward_redeemed'
 * templateData: { childName, rewardName, pointsSpent, newBalance, redemptionId }
 */

import { baseLayout, ctaButton, infoRow, infoTable } from './base';

export interface RewardRedeemedData {
  childName: string;
  rewardName: string;
  pointsSpent: number;
  newBalance: number;
  redemptionId: string;
}

export function buildRewardRedeemed(data: RewardRedeemedData): string {
  const { childName, rewardName, pointsSpent, newBalance, redemptionId } = data;

  const redemptionUrl = `${process.env.FRONTEND_URL || process.env.CLIENT_URL?.split(',')[0] || 'http://localhost:3000'}/parent/rewards/redemptions/${redemptionId}`;

  const inner = `
  <!-- Body -->
  <tr>
    <td style="padding:40px 40px 16px;">
      <h2 style="margin:0 0 12px;color:#1e293b;font-size:22px;font-weight:700;">
        Reward redeemed 🎁
      </h2>
      <p style="margin:0 0 20px;color:#475569;font-size:16px;line-height:1.6;">
        <strong>${childName}</strong> has redeemed a reward using their points.
        You may need to fulfil this reward.
      </p>

      ${infoTable([
        infoRow('Reward', rewardName),
        infoRow('Redeemed by', childName),
        infoRow('Points spent', `${pointsSpent} pts`),
        infoRow('Remaining balance', `${newBalance} pts`),
      ].join(''))}

      ${ctaButton('View Redemption', redemptionUrl)}

      <p style="margin:0;color:#94a3b8;font-size:13px;line-height:1.6;">
        Once you've fulfilled the reward, mark it as completed in the redemptions page.
      </p>
    </td>
  </tr>`;

  return baseLayout(
    inner,
    `${childName} redeemed "${rewardName}" for ${pointsSpent} points.`,
  );
}
