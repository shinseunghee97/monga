# Monga 몽가

3분 동안 스트레스 신호와 기질을 점검하고, 나에게 맞는 회복 활동을 추천받는 웹 앱입니다.
결과는 몽가 캐릭터 4종(태양형 · 숲그늘형 · 바람형 · 달빛형)으로 보여주고, 감정 일기 · 회복 활동 기록 · 방 꾸미기로 이어서 사용할 수 있습니다.

## 파일 구성

| 파일 | 내용 |
|---|---|
| `index.html` | 앱 전체 (화면, 캐릭터, 결과 이미지 생성, 기록 저장이 모두 이 파일 하나에 들어 있음) |
| `apps-script/monga_sheet_script.gs` | 응답을 구글 시트에 쌓고 추천 집계를 내려주는 Google Apps Script |

## 웹으로 배포하기 (GitHub Pages)

1. 저장소의 **Settings → Pages**로 이동합니다.
2. **Build and deployment → Source**를 `Deploy from a branch`로, **Branch**를 `main` / `(root)`로 고르고 **Save**를 누릅니다.
3. 1~2분 뒤 `https://shinseunghee97.github.io/monga/` 주소로 열 수 있습니다.

배포 뒤에는 `index.html` 위쪽의 `SHARE_URL`에 위 주소를 넣어 두면, 친구 공유와 이미지 공유에 항상 같은 링크가 붙습니다.

## 고칠 때 확인할 설정 (`index.html` 위쪽)

| 설정 | 설명 |
|---|---|
| `SHEET_WEBHOOK_URL` | Apps Script를 웹 앱으로 배포하고 받은 주소 |
| `SHARE_URL` | 공유할 때 붙일 앱 주소 (비워 두면 지금 열린 주소를 사용) |
| `DATA_RETENTION` | 동의서에 표시되는 보관 기간 |
| `PRIVACY_OFFICER`, `PRIVACY_CONTACT` | 동의서에 표시되는 개인정보 보호책임자와 문의처 |

## 구글 시트 연결 (Apps Script)

1. 응답을 쌓을 구글 시트를 열고 **확장 프로그램 → Apps Script**에 `apps-script/monga_sheet_script.gs` 내용을 붙여넣습니다.
2. `SPREADSHEET_ID`에 시트 주소의 `/d/`와 `/edit` 사이 문자열을 넣습니다.
3. `setupTest`를 한 번 실행해 머리글을 만들고 연결을 확인합니다.
4. **배포 → 배포 관리**에서 "새 버전"으로 웹 앱을 배포하고, 받은 주소를 `SHEET_WEBHOOK_URL`에 넣습니다.

## 데이터 저장 방식

- 일기, 활동 기록, 방 꾸미기는 사용자의 브라우저(localStorage)에만 저장됩니다. 다른 기기나 다른 브라우저에서는 따로 시작됩니다.
- 구글 시트로는 개인정보 수집·이용에 동의한 사용자의 익명 ID와 점검 응답, 활동 체크인만 전송됩니다. 일기 내용은 전송하지 않습니다.
- 테스트할 때는 주소 끝에 `?reset=1`을 붙여 열면 이 기기의 기록을 지우고 처음부터 시작합니다.

## 안내

이 앱은 자가 점검과 자기돌봄을 위한 도구이며, 전문적인 심리 진단을 대체하지 않습니다.
