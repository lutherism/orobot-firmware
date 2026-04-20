/**
 * Flash Manager — SD card firmware flasher
 * 
 * Features:
 * - Detect up to 8 connected drives
 * - Select distribution (RPi, ESP32, etc.)
 * - Flash button with progress
 * - Use balenaetcher/dd for writing
 */

import React, { useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { formatSize, type Drive, type Distribution, type FlashState } from './flashUtils';

// Distributions loaded from distribution-config.json
// Will be passed in from parent component

// ─── Tokens (same as dashboard) ────────────────────────────────────────────────

const T = {
  bgBase:      '#0f1117',
  bgHeader:    '#1a1f2e',
  border:      '#2d3748',
  borderFaint: '#1e293b',
  text:        '#e2e8f0',
  textMuted:   '#94a3b8',
  textDim:     '#64748b',
  accent:      '#7c3aed',
  blue:        '#3b82f6',
  green:       '#10b981',
  amber:       '#f59e0b',
  red:         '#ef4444',
} as const;

// ─── Styles ─────────────────────────────────────────────────────────────

const Container = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  background: ${T.bgBase};
`;

const Header = styled.div`
  padding: 16px 20px;
  border-bottom: 1px solid ${T.border};
`;

const Title = styled.h2`
  font-size: 14px;
  font-weight: 600;
  color: ${T.text};
  margin: 0 0 8px 0;
`;

const Subtitle = styled.p`
  font-size: 12px;
  color: ${T.textMuted};
  margin: 0;
`;

const Content = styled.div`
  flex: 1;
  padding: 16px 20px;
  overflow-y: auto;
`;

const Section = styled.div`
  margin-bottom: 24px;
`;

const SectionTitle = styled.h3`
  font-size: 11px;
  font-weight: 600;
  color: ${T.textMuted};
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 0 0 12px 0;
`;

const DriveGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
`;

const DriveCard = styled.button<{ $selected: boolean }>`
  background: ${({ $selected }) => $selected ? '#1e293b' : '#111827'};
  border: 1px solid ${({ $selected }) => $selected ? T.blue : T.border};
  border-radius: 8px;
  padding: 16px;
  cursor: pointer;
  text-align: left;
  transition: all 0.15s;
  
  &:hover {
    border-color: ${T.blue};
  }
`;

const DriveLetter = styled.div`
  font-size: 20px;
  font-weight: 700;
  color: ${T.text};
  margin-bottom: 4px;
`;

const DriveName = styled.div`
  font-size: 12px;
  color: ${T.textMuted};
  margin-bottom: 4px;
`;

const DriveSize = styled.div`
  font-size: 11px;
  color: ${T.textDim};
`;

const spinner = keyframes`
  0% { content: '.' }
  33% { content: '..' }
  66% { content: '...' }
`;

const DriveSpinner = styled.div`
  font-size: 11px;
  color: ${T.amber};
  &::after {
    content: '';
    animation: ${spinner} 1s infinite;
  }
`;

const DriveProgressBar = styled.div`
  background: ${T.border};
  border-radius: 2px;
  height: 4px;
  overflow: hidden;
  margin-top: 4px;
`;

const DriveProgressFill = styled.div<{ $progress: number }>`
  background: ${T.blue};
  height: 100%;
  width: ${({ $progress }) => $progress}%;
  transition: width 0.3s;
`;

const DriveLogLine = styled.div`
  font-size: 10px;
  font-family: 'Consolas', monospace;
  color: ${T.textMuted};
  margin-top: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const DriveConditionBadge = styled.span<{ $condition: string }>`
  display: inline-block;
  font-size: 10px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 3px;
  margin-left: 6px;
  background: ${({ $condition }) => 
    $condition === 'ready' ? T.green : 
    $condition === 'not-found' ? T.red : 
    '#f59e0b'};
  color: white;
`;

const DriveConditionMessage = styled.div`
  font-size: 10px;
  color: ${T.amber};
  margin-top: 2px;
`;

const DriveFlashButton = styled.button<{ $disabled: boolean }>`
  background: ${({ $disabled }) => $disabled ? T.border : T.green};
  border: none;
  border-radius: 4px;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 600;
  color: ${({ $disabled }) => $disabled ? T.textDim : 'white'};
  cursor: ${({ $disabled }) => $disabled ? 'not-allowed' : 'pointer'};
  margin-top: 8px;
`;

const DriveActions = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-top: 8px;
`;

const GlobalFlashButton = styled.button<{ $disabled: boolean }>`
  background: ${({ $disabled }) => $disabled ? T.border : T.accent};
  border: none;
  border-radius: 6px;
  padding: 10px 20px;
  font-size: 13px;
  font-weight: 600;
  color: ${({ $disabled }) => $disabled ? T.textDim : 'white'};
  cursor: ${({ $disabled }) => $disabled ? 'not-allowed' : 'pointer'};
`;

const AddDriveButton = styled.button`
  background: transparent;
  border: 1px dashed ${T.border};
  border-radius: 8px;
  padding: 16px;
  cursor: pointer;
  text-align: center;
  color: ${T.textMuted};
  font-size: 12px;
  transition: all 0.15s;
  
  &:hover {
    border-color: ${T.blue};
    color: ${T.text};
  }
`;

const Modal = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
`;

const ModalContent = styled.div`
  background: ${T.bgBase};
  border: 1px solid ${T.border};
  border-radius: 12px;
  padding: 24px;
  width: 400px;
`;

const ModalTitle = styled.h3`
  font-size: 16px;
  font-weight: 600;
  color: ${T.text};
  margin: 0 0 16px 0;
`;

const ModalInput = styled.input`
  background: #111827;
  border: 1px solid ${T.border};
  border-radius: 6px;
  padding: 10px 12px;
  font-size: 13px;
  color: ${T.text};
  width: 100%;
  margin-bottom: 16px;
  
  &:focus {
    outline: none;
    border-color: ${T.blue};
  }
`;

const ModalButtons = styled.div`
  display: flex;
  gap: 12px;
  justify-content: flex-end;
`;

const ModalButton = styled.button<{ $primary?: boolean }>`
  background: ${({ $primary, $disabled }) => $primary ? ($disabled ? T.border : T.blue) : 'transparent'};
  border: 1px solid ${T.border};
  border-radius: 6px;
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 600;
  color: ${({ $primary }) => $primary ? 'white' : T.textMuted};
  cursor: pointer;
  
  &:hover {
    border-color: ${T.blue};
  }
`;

const DriveInfo = styled.div`
  flex: 1;
`;

const DistroList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const DistroCard = styled.button<{ $selected: boolean }>`
  background: ${({ $selected }) => $selected ? '#1e293b' : '#111827'};
  border: 1px solid ${({ $selected }) => $selected ? T.accent : T.border};
  border-radius: 8px;
  padding: 12px 16px;
  cursor: pointer;
  text-align: left;
  transition: all 0.15s;
  
  &:hover {
    border-color: ${T.accent};
  }
`;

const DistroName = styled.div`
  font-size: 13px;
  font-weight: 600;
  color: ${T.text};
  margin-bottom: 2px;
`;

const DistroDesc = styled.div`
  font-size: 11px;
  color: ${T.textMuted};
`;

const ButtonRow = styled.div`
  display: flex;
  gap: 12px;
  margin-top: 16px;
`;

const FlashButton = styled.button<{ $disabled: boolean }>`
  background: ${({ $disabled }) => $disabled ? T.border : T.green};
  border: none;
  border-radius: 6px;
  padding: 10px 20px;
  font-size: 13px;
  font-weight: 600;
  color: ${({ $disabled }) => $disabled ? T.textDim : 'white'};
  cursor: ${({ $disabled }) => $disabled ? 'not-allowed' : 'pointer'};
  opacity: ${({ $disabled }) => $disabled ? 0.5 : 1};
`;

const ProgressBar = styled.div`
  background: ${T.border};
  border-radius: 4px;
  height: 8px;
  overflow: hidden;
  margin-top: 16px;
`;

const ProgressFill = styled.div<{ $progress: number }>`
  background: ${T.blue};
  height: 100%;
  width: ${({ $progress }) => $progress}%;
  transition: width 0.3s;
`;

const LogBox = styled.pre`
  background: #0a0a0a;
  border: 1px solid ${T.border};
  border-radius: 4px;
  padding: 12px;
  font-size: 11px;
  font-family: 'Consolas', monospace;
  color: ${T.green};
  height: 100px;
  overflow-y: auto;
margin-top: 12px;
  white-space: pre-wrap;
 `;

// ─── Main Component ────────────────────────────────────────────────────

interface FlashManagerProps {
  drives: Drive[];
  distributions: Distribution[];
  flashState: FlashState;
  onFlash: (driveLetter: string, distroId: string) => void;
  onCancel: () => void;
  onAddDrive: (drive: Drive) => void;
}

export function FlashManager({
  drives,
  distributions,
  flashState,
  onFlash,
  onCancel,
  onAddDrive,
}: FlashManagerProps) {
  const [selectedDrive, setSelectedDrive] = useState<string | null>(null);
  const [selectedDistro, setSelectedDistro] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [manualLetter, setManualLetter] = useState('');
  const [manualName, setManualName] = useState('');

  const formatSizeFn = (bytes: number) => {
    const gb = bytes / (1024 * 1024 * 1024);
    return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  };

  const canFlash = selectedDrive && selectedDistro && flashState.status === 'idle';

  const handleAddDrive = () => {
    if (manualLetter) {
      onAddDrive({ letter: manualLetter, name: manualName || 'Manual Drive', size: 0, free: 0 });
      setManualLetter('');
      setManualName('');
      setShowAddModal(false);
    }
  };

  const flashingDrives = flashState.drivesFlashing || [];

  const getDriveStatus = (letter: string) => {
    if (flashingDrives.includes(letter)) {
      const driveFlash = flashState.driveProgress?.[letter];
      return driveFlash ? `${Math.round(driveFlash)}%` : 'Flashing';
    }
    return null;
  };

  const hasIdleDrives = drives.length > 0 && flashState.status === 'idle';

  return (
    <Container>
      <Header>
        <Title>Flash Manager</Title>
        <Subtitle>Write orobot firmware to SD cards and storage devices</Subtitle>
      </Header>

      <Content>
        {/* Drives Section */}
        <Section>
          <SectionTitle>Target Drives (max 8)</SectionTitle>
          <DriveGrid>
            {drives.length === 0 ? (
              <DriveCard $selected={false} disabled style={{ gridColumn: '1 / -1' }}>
                <DriveName style={{ color: T.textDim }}>No drives detected</DriveName>
                <DriveSize>Connect an SD card or USB drive</DriveSize>
              </DriveCard>
            ) : drives.map(drive => {
              const driveFlashState = flashState.driveStates?.[drive.letter];
              const driveLog = flashState.driveLogs?.[drive.letter];
              const isFlashing = driveFlashState && driveFlashState.status !== 'idle' && driveFlashState.status !== 'complete' && driveFlashState.status !== 'error';
              const isComplete = driveFlashState?.status === 'complete';
              const isError = driveFlashState?.status === 'error';
              
              return (
                <DriveCard
                  key={drive.letter}
                  $selected={selectedDrive === drive.letter}
                  onClick={() => !isFlashing && setSelectedDrive(drive.letter)}
                  style={{ opacity: isFlashing ? 0.7 : 1 }}
                >
                  <DriveInfo>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      <DriveLetter>{drive.letter}</DriveLetter>
                      {drive.condition && (
                        <DriveConditionBadge $condition={drive.condition}>
                          {drive.condition}
                        </DriveConditionBadge>
                      )}
                    </div>
                    <DriveName>{drive.name || 'Removable Disk'}</DriveName>
                    {drive.conditionMessage && (
                      <DriveConditionMessage>{drive.conditionMessage}</DriveConditionMessage>
                    )}
                    <DriveSize>{formatSizeFn(drive.size)}</DriveSize>
                    
                    {/* Flash progress UI: indeterminate spinner */}
                    {driveFlashState?.status === 'preparing' && (
                      <DriveSpinner>Preparing{driveFlashState.status}</DriveSpinner>
                    )}
                    
                    {/* Flash progress UI: determinate progress bar */}
                    {driveFlashState?.status === 'flashing' && driveFlashState.progress > 0 && (
                      <>
                        <DriveProgressBar>
                          <DriveProgressFill $progress={driveFlashState.progress} />
                        </DriveProgressBar>
                        <DriveSize style={{ color: T.blue }}>{driveFlashState.progress}%</DriveSize>
                      </>
                    )}
                    
                    {/* Flash progress UI: 1-line tail log */}
                    {driveFlashState?.status === 'verifying' && (
                      <DriveLogLine>Verifying write...</DriveLogLine>
                    )}
                    
                    {driveLog && driveLog.length > 0 && (
                      <DriveLogLine>{driveLog}</DriveLogLine>
                    )}
                    
                    {isComplete && <DriveSize style={{ color: T.green }}>Complete</DriveSize>}
                    {isError && <DriveSize style={{ color: T.red }}>{driveFlashState.error || 'Error'}</DriveSize>}
                  </DriveInfo>
                  <DriveActions>
                    <DriveFlashButton
                      $disabled={!selectedDistro || isFlashing || isComplete}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (selectedDistro && !isFlashing && !isComplete) {
                          onFlash(drive.letter, selectedDistro);
                        }
                      }}
                    >
                      {isComplete ? 'Done' : isFlashing ? 'Flashing' : 'Flash'}
                    </DriveFlashButton>
                  </DriveActions>
                </DriveCard>
              );
            })}
            {drives.length < 8 && (
              <AddDriveButton onClick={() => setShowAddModal(true)}>
                + Add Drive
              </AddDriveButton>
            )}
          </DriveGrid>
        </Section>

        {/* Distribution Section */}
        <Section>
          <SectionTitle>Select Distribution</SectionTitle>
          <DistroList>
            {distributions.map(distro => (
              <DistroCard
                key={distro.id}
                $selected={selectedDistro === distro.id}
                onClick={() => setSelectedDistro(distro.id)}
              >
                <DistroName>{distro.label}</DistroName>
                <DistroDesc>{distro.description}</DistroDesc>
              </DistroCard>
            ))}
          </DistroList>
        </Section>

        {/* Action Section */}
        <Section>
          <ButtonRow>
            <GlobalFlashButton
              $disabled={!selectedDistro || !hasIdleDrives}
              onClick={() => {
                if (selectedDistro && hasIdleDrives) {
                  drives.forEach(drive => {
                    if (!flashingDrives.includes(drive.letter)) {
                      onFlash(drive.letter, selectedDistro);
                    }
                  });
                }
              }}
            >
              Flash All Idle Drives
            </GlobalFlashButton>
            
            {flashState.status !== 'idle' && flashState.status !== 'complete' && (
              <FlashButton $disabled={false} onClick={onCancel}>
                Cancel
              </FlashButton>
            )}
          </ButtonRow>

          {flashState.status !== 'idle' && (
            <>
              <ProgressBar>
                <ProgressFill $progress={flashState.progress} />
              </ProgressBar>
              <LogBox>
                {flashState.log.join('\n')}
              </LogBox>
            </>
          )}
        </Section>
      </Content>

      {/* Add Drive Modal */}
      {showAddModal && (
        <Modal onClick={() => setShowAddModal(false)}>
          <ModalContent onClick={e => e.stopPropagation()}>
            <ModalTitle>Add Drive Manually</ModalTitle>
            <ModalInput
              placeholder="Drive letter (e.g., G:)"
              value={manualLetter}
              onChange={e => setManualLetter(e.target.value)}
              autoFocus
            />
            <ModalInput
              placeholder="Drive name (optional)"
              value={manualName}
              onChange={e => setManualName(e.target.value)}
            />
            <ModalButtons>
              <ModalButton onClick={() => setShowAddModal(false)}>Cancel</ModalButton>
              <ModalButton $primary onClick={handleAddDrive}>Add</ModalButton>
            </ModalButtons>
          </ModalContent>
        </Modal>
      )}
    </Container>
  );
}

// ─── Drive detection (Node.js side) ─────────────────────────────────────────────

/**
 * Detect removable drives on Windows
 * Returns array of Drive objects
 */
export async function detectDrives(): Promise<Drive[]> {
  // This would run on the server side via an API endpoint
  // For now, return mock data for testing the UI
  return [
    { letter: 'E:', name: 'SD_CARD', size: 32 * 1024 * 1024 * 1024, free: 0 },
    { letter: 'F:', name: 'USB_DRIVE', size: 64 * 1024 * 1024 * 1024, free: 32 * 1024 * 1024 * 1024 },
  ];
}