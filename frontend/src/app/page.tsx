'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { CheckCircle2, Trophy, Users, Sparkles, Star, Gift } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/contexts/AuthContext';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function HomePage() {
  const { isAuthenticated, isParent, isChild, isLoading } = useAuth();
  const router = useRouter();

  // Redirect if already authenticated
  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      if (isParent) {
        router.push('/parent/dashboard');
      } else if (isChild) {
        router.push('/child/dashboard');
      }
    }
  }, [isLoading, isAuthenticated, isParent, isChild, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-primary-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary-50 via-white to-xp-50">
      {/* Hero Section */}
      <header className="relative overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 pb-20">
          <nav className="flex justify-between items-center mb-16">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 bg-gradient-to-br from-primary-400 to-primary-600 rounded-xl flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6 text-white" />
              </div>
              <span className="font-display font-bold text-2xl text-slate-900">
                TaskBuddy
              </span>
            </div>
            <div className="flex items-center gap-4">
              <Link href="/login">
                <Button variant="ghost" size="md">
                  Log in
                </Button>
              </Link>
              <Link href="/register">
                <Button variant="primary" size="md">
                  Get Started
                </Button>
              </Link>
            </div>
          </nav>

          <div className="flex flex-col lg:flex-row items-center gap-12">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6 }}
              className="flex-1 text-center lg:text-left"
            >
              <h1 className="font-display text-5xl sm:text-6xl font-bold text-slate-900 leading-tight mb-6">
                Make Chores Fun for the{' '}
                <span className="text-gradient-primary">Whole Family</span>
              </h1>
              <p className="text-xl text-slate-600 mb-8 max-w-xl mx-auto lg:mx-0">
                TaskBuddy helps families turn everyday tasks into exciting adventures.
                Kids earn points, unlock achievements, and learn responsibility!
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
                <Link href="/register">
                  <Button size="lg" className="shadow-lg shadow-primary-500/30">
                    <Sparkles className="w-5 h-5" />
                    Start Your Family Adventure
                  </Button>
                </Link>
                <Link href="/child/login">
                  <Button variant="outline" size="lg">
                    <Users className="w-5 h-5" />
                    Child Login
                  </Button>
                </Link>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="flex-1 relative"
            >
              {/* Floating cards mockup */}
              <div className="relative w-full max-w-md mx-auto">
                {/* Main card */}
                <div className="bg-white rounded-2xl shadow-2xl p-6 z-10 relative">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-12 h-12 bg-gradient-to-br from-xp-400 to-xp-600 rounded-full flex items-center justify-center text-white font-bold">
                      12
                    </div>
                    <div>
                      <p className="font-bold text-slate-900">Alex</p>
                      <p className="text-sm text-slate-500">Level 12 Task Master</p>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between p-3 bg-success-50 rounded-lg">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-5 h-5 text-success-500" />
                        <span className="text-sm font-medium">Make bed</span>
                      </div>
                      <span className="text-sm font-bold text-gold-600">+15 pts</span>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                      <div className="flex items-center gap-2">
                        <div className="w-5 h-5 border-2 border-slate-300 rounded" />
                        <span className="text-sm font-medium">Clean room</span>
                      </div>
                      <span className="text-sm text-slate-500">30 pts</span>
                    </div>
                  </div>
                </div>

                {/* Floating streak badge */}
                <motion.div
                  animate={{ y: [0, -5, 0] }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className="absolute -top-4 -right-4 bg-gradient-to-r from-orange-400 to-red-500 text-white px-4 py-2 rounded-full shadow-lg flex items-center gap-2"
                >
                  <span className="text-lg">🔥</span>
                  <span className="font-bold">7 day streak!</span>
                </motion.div>

                {/* Floating points */}
                <motion.div
                  animate={{ y: [0, -5, 0] }}
                  transition={{ duration: 2, repeat: Infinity, delay: 0.5 }}
                  className="absolute -bottom-4 -left-4 bg-white rounded-xl shadow-lg px-4 py-3 flex items-center gap-2"
                >
                  <Star className="w-6 h-6 text-gold-500" />
                  <span className="font-bold text-slate-900">2,450 points</span>
                </motion.div>
              </div>
            </motion.div>
          </div>
        </div>
      </header>

      {/* Features Section */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="font-display text-4xl font-bold text-slate-900 mb-4">
              Why Families Love TaskBuddy
            </h2>
            <p className="text-lg text-slate-600 max-w-2xl mx-auto">
              Turn household responsibilities into a fun, rewarding experience for everyone
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {features.map((feature, index) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
                className="bg-slate-50 rounded-2xl p-8 text-center hover:bg-slate-100 transition-colors"
              >
                <div
                  className={`w-16 h-16 mx-auto mb-6 rounded-2xl flex items-center justify-center ${feature.iconBg}`}
                >
                  <feature.icon className={`w-8 h-8 ${feature.iconColor}`} />
                </div>
                <h3 className="font-display text-xl font-bold text-slate-900 mb-3">
                  {feature.title}
                </h3>
                <p className="text-slate-600">{feature.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 bg-gradient-to-br from-primary-500 to-primary-700">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="font-display text-4xl font-bold text-white mb-6">
            Ready to Start Your Family&apos;s Adventure?
          </h2>
          <p className="text-xl text-primary-100 mb-8">
            Join thousands of families making chores fun and rewarding
          </p>
          <Link href="/register">
            <Button
              size="xl"
              variant="secondary"
              className="shadow-xl"
            >
              <Sparkles className="w-6 h-6" />
              Create Your Family Account
            </Button>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 bg-slate-900 text-slate-400">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row justify-between items-center gap-6">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-primary-400 to-primary-600 rounded-lg flex items-center justify-center">
                <CheckCircle2 className="w-5 h-5 text-white" />
              </div>
              <span className="font-display font-bold text-xl text-white">
                TaskBuddy
              </span>
            </div>
            <p className="text-sm">
              &copy; {new Date().getFullYear()} TaskBuddy. Making chores fun for families.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

const features = [
  {
    title: 'Gamified Tasks',
    description:
      'Turn everyday chores into exciting quests. Earn points, level up, and unlock achievements!',
    icon: Trophy,
    iconBg: 'bg-gold-100',
    iconColor: 'text-gold-600',
  },
  {
    title: 'Family Rewards',
    description:
      'Create custom rewards that motivate. From screen time to special outings, make goals meaningful.',
    icon: Gift,
    iconBg: 'bg-xp-100',
    iconColor: 'text-xp-600',
  },
  {
    title: 'Easy to Use',
    description:
      'Simple interface designed for all ages. Kids can check tasks, parents can track progress.',
    icon: Users,
    iconBg: 'bg-success-100',
    iconColor: 'text-success-600',
  },
];
