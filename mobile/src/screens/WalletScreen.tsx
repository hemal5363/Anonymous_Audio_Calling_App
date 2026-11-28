import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  SafeAreaView,
  FlatList,
  RefreshControl,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { WalletScreenNavigationProp } from '../navigation/types';
import { api } from '../api/client';
import { getFriendlyEndMessage } from '../call/CallContext';
import { usePublicConfig } from '../config/PublicConfigContext';
import { BILLING_CURRENCY } from '../config/constants';

interface WalletResponse {
  wallet: {
    balance_amount: string;
    balance_minutes: number;
    free_trial_minutes: number;
    is_locked: boolean;
    currency: string;
  };
  current_mode: 'free' | 'subscription' | 'per_minute';
  rate_per_minute: string;
}

interface SubscriptionResponse {
  current_mode: 'free' | 'subscription' | 'per_minute';
  active_subscription: {
    id: string;
    plan_id: string;
    plan_name: string;
    status: string;
    starts_at: string;
    ends_at: string;
    daily_minute_cap: number | null;
    minutes_used_today: number;
  } | null;
  available_plans: {
    id: string;
    name: string;
    description: string;
    price: string;
    currency: string;
    duration_days: number;
    daily_minute_cap: number | null;
  }[];
}

interface CallHistoryItem {
  call_code: string;
  role: 'caller' | 'callee';
  status: string;
  duration_seconds: number;
  requested_at: string;
  ended_at?: string;
  end_reason: string;
}

interface CallHistoryResponse {
  calls: CallHistoryItem[];
  pagination: {
    total: number;
    page: number;
    limit: number;
  };
}

export default function WalletScreen() {
  const navigation = useNavigation<WalletScreenNavigationProp>();
  const { config } = usePublicConfig();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [monetizationMode, setMonetizationMode] = useState<'free' | 'subscription' | 'per_minute'>(
    config?.monetization?.mode || 'free'
  );
  const [walletData, setWalletData] = useState<WalletResponse['wallet'] | null>(null);
  const [ratePerMinute, setRatePerMinute] = useState<string>(
    String(config?.monetization?.rate_per_minute ?? '1.00')
  );
  const [subscriptionData, setSubscriptionData] = useState<SubscriptionResponse['active_subscription'] | null>(null);
  const [availablePlans, setAvailablePlans] = useState<SubscriptionResponse['available_plans']>([]);
  const [callHistory, setCallHistory] = useState<CallHistoryItem[]>([]);

  const fetchData = async () => {
    setErrorMessage(null);
    try {
      // 1. Fetch wallet & mode
      const walletRes = await api.get<WalletResponse>('/billing/wallet').catch(() => null);
      if (walletRes) {
        setMonetizationMode(walletRes.current_mode);
        setWalletData(walletRes.wallet);
        setRatePerMinute(walletRes.rate_per_minute);
      }

      // 2. Fetch subscription details if in subscription mode
      const subRes = await api.get<SubscriptionResponse>('/billing/subscription').catch(() => null);
      if (subRes) {
        if (!walletRes) setMonetizationMode(subRes.current_mode);
        setSubscriptionData(subRes.active_subscription);
        setAvailablePlans(subRes.available_plans || []);
      }

      // 3. Fetch call history
      const historyRes = await api.get<CallHistoryResponse>('/calls/history?limit=30').catch(() => null);
      if (historyRes?.calls) {
        setCallHistory(historyRes.calls);
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Could not load wallet data.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'Recent';
    try {
      const d = new Date(dateString);
      return d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateString;
    }
  };

  const formatDuration = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    if (mins === 0) return `${secs}s`;
    return `${mins}m ${secs.toString().padStart(2, '0')}s`;
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Top Header */}
      <View style={styles.topHeader}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
        >
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Wallet & History</Text>
        <View style={{ width: 50 }} />
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#38bdf8" />
          <Text style={styles.loadingText}>Loading balance and call history...</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.container}
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor="#38bdf8"
            />
          }
        >
          {/* Error Banner */}
          {errorMessage ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          ) : null}

          {/* ------------------------------------------------------------- */}
          {/* Section 1: Monetization State (Show ONLY what applies)         */}
          {/* ------------------------------------------------------------- */}

          {/* Mode A: FREE MODE (Show nothing except free info banner) */}
          {monetizationMode === 'free' && (
            <View style={styles.card}>
              <View style={styles.badgeRow}>
                <View style={styles.freeBadge}>
                  <Text style={styles.freeBadgeText}>100% Free Mode</Text>
                </View>
              </View>
              <Text style={styles.cardTitle}>Free Calling Active</Text>
              <Text style={styles.cardSubtitle}>
                {config.monetization.free_daily_minute_cap > 0
                  ? `Calls are free on this platform up to ${config.monetization.free_daily_minute_cap} mins per day.`
                  : 'Calls are completely free on this platform. Enjoy unlimited anonymous voice conversations!'}
              </Text>
            </View>
          )}

          {/* Mode B: SUBSCRIPTION MODE (Show subscription status and plans) */}
          {monetizationMode === 'subscription' && (
            <View style={styles.card}>
              <View style={styles.badgeRow}>
                <View style={styles.subscriptionBadge}>
                  <Text style={styles.subscriptionBadgeText}>Subscription Mode</Text>
                </View>
              </View>

              {subscriptionData ? (
                <View style={styles.activeSubBox}>
                  <Text style={styles.subPlanName}>{subscriptionData.plan_name}</Text>
                  <Text style={styles.subExpiry}>
                    Active until {formatDate(subscriptionData.ends_at)}
                  </Text>
                  {subscriptionData.daily_minute_cap && subscriptionData.daily_minute_cap > 0 ? (
                    <Text style={styles.subUsage}>
                      Today's usage: {subscriptionData.minutes_used_today} /{' '}
                      {subscriptionData.daily_minute_cap} mins
                    </Text>
                  ) : (
                    <Text style={styles.subUsage}>Unlimited daily minutes</Text>
                  )}
                </View>
              ) : (
                <View style={styles.noSubBox}>
                  <Text style={styles.noSubTitle}>No Active Subscription</Text>
                  <Text style={styles.noSubSubtitle}>
                    An active plan is required to initiate calls in subscription mode.
                  </Text>
                </View>
              )}

              {/* Available Plans */}
              {availablePlans.length > 0 && (
                <View style={styles.plansSection}>
                  <Text style={styles.plansHeader}>Available Plans</Text>
                  {availablePlans.map((plan) => (
                    <View key={plan.id} style={styles.planCard}>
                      <View style={styles.planRow}>
                        <Text style={styles.planName}>{plan.name}</Text>
                        <Text style={styles.planPrice}>
                          {BILLING_CURRENCY} {plan.price}
                        </Text>
                      </View>
                      <Text style={styles.planDesc}>{plan.description}</Text>
                      <Text style={styles.planValidity}>
                        Valid for {plan.duration_days} days
                        {plan.daily_minute_cap && plan.daily_minute_cap > 0 ? ` • ${plan.daily_minute_cap} mins/day` : ' • Unlimited'}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}

          {/* Mode C: PER-MINUTE MODE (Show balance and top-up button) */}
          {monetizationMode === 'per_minute' && (
            <View style={styles.card}>
              <View style={styles.badgeRow}>
                <View style={styles.perMinuteBadge}>
                  <Text style={styles.perMinuteBadgeText}>Per-Minute Billing</Text>
                </View>
              </View>

              <Text style={styles.balanceLabel}>Current Wallet Balance</Text>
              <Text style={styles.balanceAmount}>
                {BILLING_CURRENCY} {walletData?.balance_amount || '0.00'}
              </Text>

              <View style={styles.rateRow}>
                <Text style={styles.rateText}>
                  Rate: {BILLING_CURRENCY} {ratePerMinute} / min
                </Text>
                {walletData?.free_trial_minutes ? (
                  <Text style={styles.trialText}>
                    🎁 {walletData.free_trial_minutes} trial mins remaining
                  </Text>
                ) : config.monetization.free_trial_minutes_new_user > 0 ? (
                  <Text style={styles.trialText}>
                    🎁 {config.monetization.free_trial_minutes_new_user} trial mins (new users)
                  </Text>
                ) : null}
              </View>

              {config.monetization.minimum_balance > 0 ? (
                <Text style={styles.minBalanceText}>
                  Minimum balance required: {BILLING_CURRENCY} {Number(config.monetization.minimum_balance).toFixed(2)}
                </Text>
              ) : null}

              {/* Top-Up Button: Disabled with "Coming soon" as payment gateway is pending */}
              <TouchableOpacity
                style={[styles.topUpButton, styles.topUpButtonDisabled]}
                disabled={true}
                activeOpacity={0.6}
              >
                <Text style={styles.topUpButtonText}>Top-up Balance (Coming soon)</Text>
              </TouchableOpacity>
              <Text style={styles.topUpHelper}>
                Online payment recharge gateway is coming in the next release.
              </Text>
            </View>
          )}

          {/* ------------------------------------------------------------- */}
          {/* Section 2: Call History List (Date, Duration, End Reason ONLY) */}
          {/* ------------------------------------------------------------- */}
          <View style={styles.historySection}>
            <Text style={styles.historySectionTitle}>Call History</Text>
            <Text style={styles.historySubtitle}>
              Strictly anonymous: Only date, duration, and end reason are recorded.
            </Text>

            {callHistory.length === 0 ? (
              <View style={styles.emptyHistoryBox}>
                <Text style={styles.emptyHistoryIcon}>📞</Text>
                <Text style={styles.emptyHistoryTitle}>No Calls Recorded</Text>
                <Text style={styles.emptyHistoryText}>
                  Your past anonymous voice calls will appear here.
                </Text>
              </View>
            ) : (
              <View style={styles.historyList}>
                {callHistory.map((item) => (
                  <View key={item.call_code} style={styles.historyItem}>
                    <View style={styles.historyLeft}>
                      <Text style={styles.historyTitle}>
                        {item.role === 'caller' ? 'Outgoing Call' : 'Incoming Call'}
                      </Text>
                      <Text style={styles.historyDate}>{formatDate(item.requested_at)}</Text>
                    </View>

                    <View style={styles.historyRight}>
                      <Text style={styles.historyDuration}>
                        {formatDuration(item.duration_seconds || 0)}
                      </Text>
                      <Text style={styles.historyReason}>
                        {getFriendlyEndMessage(item.end_reason)}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0a0f1d',
  },
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  backButton: {
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  backButtonText: {
    color: '#38bdf8',
    fontSize: 15,
    fontWeight: '600',
  },
  headerTitle: {
    color: '#f8fafc',
    fontSize: 17,
    fontWeight: '700',
  },
  container: {
    flex: 1,
  },
  content: {
    padding: 18,
    paddingBottom: 40,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  loadingText: {
    color: '#94a3b8',
    fontSize: 13,
    marginTop: 12,
  },
  errorBox: {
    backgroundColor: '#450a0a',
    borderWidth: 1,
    borderColor: '#b91c1c',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    color: '#fca5a5',
    fontSize: 13,
  },
  card: {
    backgroundColor: '#131b2e',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: '#1e293b',
    marginBottom: 24,
  },
  badgeRow: {
    flexDirection: 'row',
    marginBottom: 10,
  },
  freeBadge: {
    backgroundColor: '#064e3b',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
  },
  freeBadgeText: {
    color: '#34d399',
    fontSize: 11,
    fontWeight: 'bold',
  },
  subscriptionBadge: {
    backgroundColor: '#312e81',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
  },
  subscriptionBadgeText: {
    color: '#a5b4fc',
    fontSize: 11,
    fontWeight: 'bold',
  },
  perMinuteBadge: {
    backgroundColor: '#083344',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
  },
  perMinuteBadgeText: {
    color: '#38bdf8',
    fontSize: 11,
    fontWeight: 'bold',
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#f8fafc',
    marginBottom: 4,
  },
  cardSubtitle: {
    fontSize: 13,
    color: '#94a3b8',
    lineHeight: 18,
  },
  balanceLabel: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
  },
  balanceAmount: {
    color: '#f8fafc',
    fontSize: 32,
    fontWeight: '800',
  },
  rateRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 16,
  },
  rateText: {
    color: '#cbd5e1',
    fontSize: 13,
  },
  trialText: {
    color: '#34d399',
    fontSize: 12,
    fontWeight: '600',
  },
  minBalanceText: {
    color: '#94a3b8',
    fontSize: 12,
    marginBottom: 14,
  },
  topUpButton: {
    backgroundColor: '#2563eb',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topUpButtonDisabled: {
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
    opacity: 0.7,
  },
  topUpButtonText: {
    color: '#94a3b8',
    fontSize: 14,
    fontWeight: '600',
  },
  topUpHelper: {
    color: '#64748b',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 6,
  },
  activeSubBox: {
    backgroundColor: '#0f172a',
    borderRadius: 10,
    padding: 14,
    marginTop: 6,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  subPlanName: {
    fontSize: 17,
    fontWeight: 'bold',
    color: '#f8fafc',
  },
  subExpiry: {
    color: '#38bdf8',
    fontSize: 12,
    marginTop: 4,
  },
  subUsage: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 4,
  },
  noSubBox: {
    backgroundColor: '#0f172a',
    borderRadius: 10,
    padding: 14,
    marginTop: 6,
  },
  noSubTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#f8fafc',
  },
  noSubSubtitle: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 4,
  },
  plansSection: {
    marginTop: 16,
  },
  plansHeader: {
    fontSize: 14,
    fontWeight: '700',
    color: '#cbd5e1',
    marginBottom: 8,
  },
  planCard: {
    backgroundColor: '#0f172a',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  planRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  planName: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#f8fafc',
  },
  planPrice: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#34d399',
  },
  planDesc: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 4,
  },
  planValidity: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 4,
  },
  historySection: {
    marginTop: 8,
  },
  historySectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#f8fafc',
  },
  historySubtitle: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 2,
    marginBottom: 14,
  },
  emptyHistoryBox: {
    backgroundColor: '#131b2e',
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  emptyHistoryIcon: {
    fontSize: 36,
    marginBottom: 8,
  },
  emptyHistoryTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#f8fafc',
  },
  emptyHistoryText: {
    fontSize: 12,
    color: '#94a3b8',
    textAlign: 'center',
    marginTop: 4,
  },
  historyList: {
    backgroundColor: '#131b2e',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
    overflow: 'hidden',
  },
  historyItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  historyLeft: {
    flex: 1,
  },
  historyTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#f8fafc',
  },
  historyDate: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  historyRight: {
    alignItems: 'flex-end',
  },
  historyDuration: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#38bdf8',
  },
  historyReason: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 2,
  },
});
