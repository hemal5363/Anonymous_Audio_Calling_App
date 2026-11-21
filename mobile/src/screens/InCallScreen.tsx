import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  SafeAreaView,
  Modal,
  TextInput,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { InCallScreenNavigationProp } from '../navigation/types';
import { useCall } from '../call/CallContext';

export default function InCallScreen() {
  const navigation = useNavigation<InCallScreenNavigationProp>();
  const {
    callStatus,
    callDuration,
    isMuted,
    isSpeaker,
    toggleMute,
    toggleSpeaker,
    endCall,
    skipCall,
    reportPeer,
    blockPeer,
    lastEndInfo,
    clearEndInfo,
  } = useCall();

  // Report modal state
  const [reportModalVisible, setReportModalVisible] = useState(false);
  const [reportReason, setReportReason] = useState<string>('harassment');
  const [reportNote, setReportNote] = useState<string>('');
  const [submittingReport, setSubmittingReport] = useState(false);

  // Navigate back to Home or Searching when call ends (never navigate to Home silently)
  useEffect(() => {
    if (callStatus === 'ended') {
      Alert.alert(
        'Call Ended',
        lastEndInfo?.friendlyMessage || 'The call has ended.',
        [
          {
            text: 'OK',
            onPress: () => {
              clearEndInfo();
              navigation.replace('Home');
            },
          },
        ],
        { cancelable: false }
      );
    } else if (callStatus === 'idle') {
      navigation.replace('Home');
    } else if (callStatus === 'searching') {
      navigation.replace('Searching');
    }
  }, [callStatus, lastEndInfo, navigation, clearEndInfo]);

  // Format MM:SS timer
  const formatTime = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleEndCall = () => {
    endCall('caller_hangup');
    navigation.replace('Home');
  };

  const handleSkip = () => {
    skipCall();
    navigation.replace('Searching');
  };

  const handleBlockPress = () => {
    Alert.alert(
      'Block User',
      'Are you sure you want to block this user? You will never be matched with them again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block & Disconnect',
          style: 'destructive',
          onPress: async () => {
            try {
              await blockPeer();
              navigation.replace('Home');
            } catch (err: any) {
              Alert.alert('Error', err?.message || 'Could not block user.');
            }
          },
        },
      ]
    );
  };

  const handleReportSubmit = async () => {
    setSubmittingReport(true);
    try {
      await reportPeer(reportReason, reportNote);
      setReportModalVisible(false);
      Alert.alert(
        'Report Submitted',
        'Thank you. Your report has been submitted to moderators for review.'
      );
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Could not submit report.');
    } finally {
      setSubmittingReport(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* Top Status & Anonymity Bar */}
        <View style={styles.topBar}>
          <View style={styles.secureBadge}>
            <Text style={styles.secureBadgeText}>🔒 Private Relay Audio</Text>
          </View>
        </View>

        {/* Center Anonymous Avatar & Duration */}
        <View style={styles.centerSection}>
          <View style={styles.partnerAvatarCircle}>
            <Text style={styles.partnerAvatarIcon}>🎙️</Text>
          </View>

          {/* Strict Anonymity: No identity shown */}
          <Text style={styles.partnerTitle}>Anonymous Partner</Text>
          <Text style={styles.timerText}>{formatTime(callDuration)}</Text>
        </View>

        {/* Secondary Safety Controls: Skip, Report, Block */}
        <View style={styles.safetyBar}>
          <TouchableOpacity
            style={styles.safetyButton}
            onPress={handleSkip}
            activeOpacity={0.7}
          >
            <Text style={styles.safetyButtonText}>⏩ Skip</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.safetyButton}
            onPress={() => setReportModalVisible(true)}
            activeOpacity={0.7}
          >
            <Text style={styles.safetyButtonText}>🚩 Report</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.safetyButton}
            onPress={handleBlockPress}
            activeOpacity={0.7}
          >
            <Text style={[styles.safetyButtonText, styles.blockText]}>🚫 Block</Text>
          </TouchableOpacity>
        </View>

        {/* Primary Controls: Mute, Speaker, End Call */}
        <View style={styles.controlsRow}>
          {/* Mute Button */}
          <TouchableOpacity
            style={[styles.controlCircle, isMuted && styles.controlCircleActive]}
            onPress={toggleMute}
            activeOpacity={0.75}
          >
            <Text style={styles.controlIcon}>{isMuted ? '🔇' : '🎤'}</Text>
            <Text style={styles.controlLabel}>{isMuted ? 'Unmute' : 'Mute'}</Text>
          </TouchableOpacity>

          {/* End Call Button */}
          <TouchableOpacity
            style={[styles.controlCircle, styles.endCallCircle]}
            onPress={handleEndCall}
            activeOpacity={0.75}
          >
            <Text style={styles.endCallIcon}>✕</Text>
            <Text style={styles.endCallLabel}>End</Text>
          </TouchableOpacity>

          {/* Speaker Button */}
          <TouchableOpacity
            style={[styles.controlCircle, isSpeaker && styles.controlCircleActive]}
            onPress={toggleSpeaker}
            activeOpacity={0.75}
          >
            <Text style={styles.controlIcon}>🔊</Text>
            <Text style={styles.controlLabel}>{isSpeaker ? 'Speaker On' : 'Speaker'}</Text>
          </TouchableOpacity>
        </View>

        {/* In-Call Report Modal */}
        <Modal
          visible={reportModalVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setReportModalVisible(false)}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Report Anonymous Partner</Text>
              <Text style={styles.modalSubtitle}>
                Select the reason for reporting this call session:
              </Text>

              {/* Reason Selector Buttons */}
              {[
                { key: 'harassment', label: 'Harassment or Abuse' },
                { key: 'abusive_language', label: 'Inappropriate Language' },
                { key: 'sexual_content', label: 'Sexual Content' },
                { key: 'scam', label: 'Scam or Fraud' },
                { key: 'other', label: 'Other Reason' },
              ].map((item) => (
                <TouchableOpacity
                  key={item.key}
                  style={[
                    styles.reasonOption,
                    reportReason === item.key && styles.reasonOptionSelected,
                  ]}
                  onPress={() => setReportReason(item.key)}
                >
                  <Text
                    style={[
                      styles.reasonOptionText,
                      reportReason === item.key && styles.reasonOptionTextSelected,
                    ]}
                  >
                    {item.label}
                  </Text>
                </TouchableOpacity>
              ))}

              <TextInput
                style={styles.noteInput}
                placeholder="Optional details for moderators..."
                placeholderTextColor="#64748b"
                value={reportNote}
                onChangeText={setReportNote}
                multiline
                numberOfLines={3}
              />

              <View style={styles.modalActionRow}>
                <TouchableOpacity
                  style={styles.modalCancelButton}
                  onPress={() => setReportModalVisible(false)}
                  disabled={submittingReport}
                >
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.modalSubmitButton}
                  onPress={handleReportSubmit}
                  disabled={submittingReport}
                >
                  <Text style={styles.modalSubmitText}>
                    {submittingReport ? 'Submitting...' : 'Submit Report'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0a0f1d',
  },
  container: {
    flex: 1,
    justifyContent: 'space-between',
    padding: 20,
    paddingVertical: 24,
  },
  topBar: {
    alignItems: 'center',
    marginTop: 10,
  },
  secureBadge: {
    backgroundColor: '#0f172a',
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  secureBadgeText: {
    color: '#38bdf8',
    fontSize: 12,
    fontWeight: '600',
  },
  centerSection: {
    alignItems: 'center',
    marginVertical: 20,
  },
  partnerAvatarCircle: {
    width: 130,
    height: 130,
    borderRadius: 65,
    backgroundColor: '#131b2e',
    borderWidth: 3,
    borderColor: '#2563eb',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    elevation: 8,
  },
  partnerAvatarIcon: {
    fontSize: 54,
  },
  partnerTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#f8fafc',
    marginBottom: 8,
  },
  timerText: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#38bdf8',
    letterSpacing: 2,
  },
  safetyBar: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 24,
  },
  safetyButton: {
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
  },
  safetyButtonText: {
    color: '#cbd5e1',
    fontSize: 13,
    fontWeight: '600',
  },
  blockText: {
    color: '#f87171',
  },
  controlsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingBottom: 20,
  },
  controlCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
    justifyContent: 'center',
    alignItems: 'center',
  },
  controlCircleActive: {
    backgroundColor: '#2563eb',
    borderColor: '#38bdf8',
  },
  controlIcon: {
    fontSize: 24,
  },
  controlLabel: {
    color: '#cbd5e1',
    fontSize: 10,
    fontWeight: '600',
    marginTop: 4,
  },
  endCallCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: '#ef4444',
    borderWidth: 0,
    elevation: 8,
  },
  endCallIcon: {
    fontSize: 30,
    color: '#ffffff',
    fontWeight: 'bold',
  },
  endCallLabel: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: 'bold',
    marginTop: 2,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#131b2e',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 360,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#f8fafc',
    marginBottom: 4,
  },
  modalSubtitle: {
    fontSize: 13,
    color: '#94a3b8',
    marginBottom: 16,
  },
  reasonOption: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#0f172a',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 8,
  },
  reasonOptionSelected: {
    borderColor: '#38bdf8',
    backgroundColor: '#1e293b',
  },
  reasonOptionText: {
    color: '#cbd5e1',
    fontSize: 13,
  },
  reasonOptionTextSelected: {
    color: '#38bdf8',
    fontWeight: 'bold',
  },
  noteInput: {
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    color: '#f8fafc',
    padding: 10,
    marginTop: 6,
    marginBottom: 16,
    fontSize: 13,
    textAlignVertical: 'top',
  },
  modalActionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  modalCancelButton: {
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  modalCancelText: {
    color: '#94a3b8',
    fontSize: 13,
  },
  modalSubmitButton: {
    backgroundColor: '#ef4444',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 8,
  },
  modalSubmitText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 'bold',
  },
});
