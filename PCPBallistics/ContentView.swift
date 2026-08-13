import SwiftUI
import Charts

// MARK: - 1. 弾道計算コアロジック
struct BallisticCalculator {
    static let gravity: Double = 9.81             // 重力加速度 (m/s^2)
    static let standardPressure: Double = 1013.25 // 標準気圧 (hPa)
    static let standardTempC: Double = 15.0       // 標準気温 (℃)

    /// 指数減速モデルの抗力定数。k = dragConstant / BC [1/m] として使う。
    /// 標準大気・G1系BC・ペレット速度域(200〜330 m/s)での近似値。
    /// ※必ず実射（50m / 75m / 100mの実測ドロップ）に合わせて微調整すること。
    static let dragConstant: Double = 0.0001

    struct CalculationResult: Identifiable {
        let id = UUID()
        let distanceMeters: Double     // 直線距離＝スラントレンジ (m)
        let horizontalDistance: Double // 水平距離 (m)
        let dropCM: Double             // 縦ズレ (cm) +:LOSより下（＝上に補正）
        let dropMIL: Double            // 縦補正量 (MIL)
        let windageCM: Double          // 横流され量 (cm) +:右へ流される（＝左に補正）
        let windageMIL: Double         // 横補正量 (MIL)
        let flightTime: Double         // 飛行時間 (秒)
        let isValid: Bool              // 入力が有効で計算できたか

        /// 着弾がLOSより下なら「上」へ補正
        var elevationHoldDirection: String { dropCM >= 0 ? "上" : "下" }
        /// 弾が流される向き
        var windageDriftDirection: String { windageCM >= 0 ? "右" : "左" }
        /// 流されと逆向きに補正（ダイヤル／ホールド方向）
        var windageHoldDirection: String { windageCM >= 0 ? "左" : "右" }
    }

    private static func emptyResult(distance: Double, horizontal: Double) -> CalculationResult {
        CalculationResult(
            distanceMeters: distance,
            horizontalDistance: horizontal,
            dropCM: 0, dropMIL: 0, windageCM: 0, windageMIL: 0,
            flightTime: 0, isValid: false
        )
    }

    /// 指定距離までの飛行時間を求める（指数減速モデル＋縦風の影響）
    /// - Parameters:
    ///   - range: 弾道に沿った射距離 (m)
    ///   - v0: 初速 (m/s, 対地)
    ///   - headWind: 縦風成分 (m/s) +:向かい風
    ///   - k: 抗力係数 (1/m)
    static func timeOfFlight(range: Double, v0: Double, headWind: Double, k: Double) -> Double {
        let u0 = v0 + headWind // 対気初速：向かい風なら速く、追い風なら遅くなる
        guard range > 0, u0 > 0 else { return 0 }

        // 静止した気団の中を s [m] 進むのに要する時間
        func airTime(_ s: Double) -> Double {
            guard s > 0 else { return 0 }
            guard k > 0 else { return s / u0 }
            let kx = min(k * s, 30.0) // exp のオーバーフロー保護
            return (exp(kx) - 1.0) / (k * u0)
        }

        // 気団を基準に見ると標的は headWind * t だけ遠ざかる（向かい風の場合）。
        // s = range + headWind * t を数回の反復で解く。
        var t = airTime(range)
        for _ in 0..<4 {
            let sAir = range + headWind * t
            guard sAir > 0 else { break }
            t = airTime(sAir)
        }
        return t
    }

    /// 弾道補正計算（角度・気圧・気温・全方向風に対応）
    static func calculate(
        velocityFPS: Double,
        weightGrains: Double,         // ※BCに弾重の影響が含まれるため現行モデルでは未使用
        bc: Double,
        distanceMeters: Double,       // R600で測った直線距離 (m)
        angleDegrees: Double,         // R600で測った角度 (度)
        zeroDistanceMeters: Double,
        sightHeightCM: Double,
        windSpeedMPS: Double,         // CHE-WD1で測った風速 (m/s)
        windClockHour: Int,           // 風向 (1〜12時)
        pressureHPA: Double,
        temperatureC: Double          // CHE-WD1で測った気温 (℃)
    ) -> CalculationResult {

        let v0 = velocityFPS * 0.3048 // m/sに変換

        // 角度から水平距離を算出（表示用。空気抵抗は実際の飛翔距離＝直線距離で効く）
        let angleRad = angleDegrees * .pi / 180.0
        let slantRange = distanceMeters
        let horizontalDistance = slantRange * cos(angleRad)

        // ゼロイン距離が0や負なら0除算になるので計算不能として扱う
        guard v0 > 0, bc > 0, slantRange > 0, horizontalDistance > 0, pressureHPA > 0,
              temperatureC > -273.15, zeroDistanceMeters >= 1.0 else {
            return emptyResult(distance: slantRange, horizontal: horizontalDistance)
        }

        let zeroDistance = zeroDistanceMeters

        // 風向（12時＝0度＝向かい風、3時＝右から吹く風）
        let windDegrees = Double((windClockHour % 12) * 30)
        let rad = windDegrees * .pi / 180.0

        let headWind = windSpeedMPS * cos(rad)   // 縦風成分 +:向かい風
        // 3時（右）から吹く風は弾を左へ流す。+ を「右へ流される」に統一するため符号反転。
        let crossWind = -windSpeedMPS * sin(rad)

        // 気圧と気温による空気密度補正（密度比 = (P/P0) * (T0/T)）
        let pressureRatio = pressureHPA / standardPressure
        let tempKelvinStd = standardTempC + 273.15
        let tempKelvinActual = temperatureC + 273.15
        let tempRatio = tempKelvinStd / tempKelvinActual

        // 空気抵抗係数 k の補正
        let k = (dragConstant / bc) * pressureRatio * tempRatio

        guard v0 + headWind > 0 else {
            return emptyResult(distance: slantRange, horizontal: horizontalDistance)
        }

        // 飛行時間（弾道に沿った距離で計算）
        let tTarget = timeOfFlight(range: slantRange, v0: v0, headWind: headWind, k: k)
        // ゼロインは「無風・水平」で取った前提。銃身の仰角は機械的に固定なので風は含めない。
        let tZero = timeOfFlight(range: zeroDistance, v0: v0, headWind: 0, k: k)

        guard tTarget > 0, tZero > 0 else {
            return emptyResult(distance: slantRange, horizontal: horizontalDistance)
        }

        // 銃身の仰角（ゼロイン時の水平射撃から算出）
        let sightHeightM = sightHeightCM / 100.0
        let dropZeroM = 0.5 * gravity * tZero * tZero
        let zeroAngle = (dropZeroM + sightHeightM) / zeroDistance

        // 重力落下は鉛直方向。LOSに直交する成分は cos(角度) 倍になる（改良ライフルマンルール）
        let dropTargetM = 0.5 * gravity * tTarget * tTarget * cos(angleRad)
        let relativeDropM = dropTargetM + sightHeightM - zeroAngle * slantRange
        let dropCM = relativeDropM * 100.0
        let dropMIL = dropCM * 10.0 / slantRange // 1MIL = 距離10mごとに1cm

        // 横流されの計算（ラグタイム法）
        let tVacuum = slantRange / v0
        let lagTime = max(tTarget - tVacuum, 0)
        let windageM = crossWind * lagTime
        let windageCM = windageM * 100.0
        let windageMIL = windageCM * 10.0 / slantRange

        return CalculationResult(
            distanceMeters: slantRange,
            horizontalDistance: horizontalDistance,
            dropCM: dropCM,
            dropMIL: dropMIL,
            windageCM: windageCM,
            windageMIL: windageMIL,
            flightTime: tTarget,
            isValid: true
        )
    }

    /// グラフ表示用に弾道データシリーズを生成
    static func generateTrajectorySeries(
        velocityFPS: Double,
        weightGrains: Double,
        bc: Double,
        angleDegrees: Double,
        zeroDistanceMeters: Double,
        sightHeightCM: Double,
        windSpeedMPS: Double,
        windClockHour: Int,
        pressureHPA: Double,
        temperatureC: Double,
        from startMeters: Double = 10.0,
        through endMeters: Double = 120.0,
        by stepMeters: Double = 5.0
    ) -> [CalculationResult] {
        return stride(from: startMeters, through: endMeters, by: stepMeters).map { d in
            calculate(
                velocityFPS: velocityFPS,
                weightGrains: weightGrains,
                bc: bc,
                distanceMeters: d,
                angleDegrees: angleDegrees,
                zeroDistanceMeters: zeroDistanceMeters,
                sightHeightCM: sightHeightCM,
                windSpeedMPS: windSpeedMPS,
                windClockHour: windClockHour,
                pressureHPA: pressureHPA,
                temperatureC: temperatureC
            )
        }
    }
}

// MARK: - 2. アプリ画面UI (ContentView)
struct ContentView: View {
    // グラフ／スライダーで扱う距離レンジ
    private let minDistance: Double = 10.0
    private let maxDistance: Double = 120.0

    // 銃・ペレット設定
    @State private var velocityFPS: String = "880"     // 例: KRAL Bighorn .30/.35
    @State private var weightGrains: String = "44.75"  // 例: JSB 44.75gr
    @State private var bc: String = "0.045"
    @State private var zeroDistance: String = "50"
    @State private var sightHeight: String = "4.5"

    // BIJIA R600 距離計からの入力値
    @State private var targetDistance: Double = 70.0   // 直線距離 (m)
    @State private var shootingAngle: Double = 0.0     // 射角 (度)

    // サンワサプライ CHE-WD1 風速計からの入力値
    @State private var windSpeedMPS: Double = 2.5      // 風速 (m/s)
    @State private var windClockHour: Int = 3          // 風向 (3時=右からの横風)
    @State private var temperatureC: Double = 15.0     // 気温 (℃)

    // 現地環境設定
    @State private var pressureHPA: Double = 1013.0    // 現地気圧 (hPa)

    // 入力値のパース（空欄・不正値でも安全な既定値に落とす）
    private var velocityValue: Double { Double(velocityFPS) ?? 0 }
    private var weightValue: Double { Double(weightGrains) ?? 0 }
    private var bcValue: Double { Double(bc) ?? 0.045 }
    private var zeroDistanceValue: Double { Double(zeroDistance) ?? 50 }
    private var sightHeightValue: Double { Double(sightHeight) ?? 4.5 }

    // 現在の計算結果
    var currentResult: BallisticCalculator.CalculationResult {
        BallisticCalculator.calculate(
            velocityFPS: velocityValue,
            weightGrains: weightValue,
            bc: bcValue,
            distanceMeters: targetDistance,
            angleDegrees: shootingAngle,
            zeroDistanceMeters: zeroDistanceValue,
            sightHeightCM: sightHeightValue,
            windSpeedMPS: windSpeedMPS,
            windClockHour: windClockHour,
            pressureHPA: pressureHPA,
            temperatureC: temperatureC
        )
    }

    // 弾道グラフ用データ
    var trajectorySeries: [BallisticCalculator.CalculationResult] {
        BallisticCalculator.generateTrajectorySeries(
            velocityFPS: velocityValue,
            weightGrains: weightValue,
            bc: bcValue,
            angleDegrees: shootingAngle,
            zeroDistanceMeters: zeroDistanceValue,
            sightHeightCM: sightHeightValue,
            windSpeedMPS: windSpeedMPS,
            windClockHour: windClockHour,
            pressureHPA: pressureHPA,
            temperatureC: temperatureC,
            from: minDistance,
            through: maxDistance
        ).filter { $0.isValid }
    }

    var body: some View {
        NavigationStack {
            Form {
                // 1. 照準補正値（Main Display）
                Section(header: Text("照準補正結果")) {
                    VStack(spacing: 8) {
                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("上下補正 (ドロップ)")
                                    .font(.caption).foregroundColor(.secondary)
                                Text(elevationCMText)
                                    .font(.title2).bold()
                                Text(elevationMILText)
                                    .font(.title3).bold().foregroundColor(.red)
                            }

                            Spacer()
                            Divider()
                            Spacer()

                            VStack(alignment: .leading, spacing: 4) {
                                Text("左右補正 (流され)")
                                    .font(.caption).foregroundColor(.secondary)
                                Text(windageCMText)
                                    .font(.title2).bold()
                                Text(windageMILText)
                                    .font(.title3).bold().foregroundColor(.blue)
                            }
                        }

                        if currentResult.isValid {
                            HStack {
                                Text("飛行時間 \(String(format: "%.2f", currentResult.flightTime)) 秒")
                                    .font(.caption2).foregroundColor(.secondary)
                                Spacer()
                                if shootingAngle != 0 {
                                    Text("※角度補正済み (水平距離: \(String(format: "%.1f", currentResult.horizontalDistance))m)")
                                        .font(.caption2)
                                        .foregroundColor(.orange)
                                }
                            }
                        } else {
                            HStack {
                                Text("※初速・BC・距離・ゼロイン距離の入力を確認してください")
                                    .font(.caption2).foregroundColor(.orange)
                                Spacer()
                            }
                        }

                        HStack {
                            Text("MIL値の向きにダイヤル／ホールドしてください")
                                .font(.caption2).foregroundColor(.secondary)
                            Spacer()
                        }
                    }
                    .padding(.vertical, 4)
                }

                // 2. 弾道グラフ (Swift Charts)
                Section(header: Text("弾道曲線 (\(Int(minDistance))m〜\(Int(maxDistance))m)")) {
                    Chart {
                        ForEach(trajectorySeries) { point in
                            LineMark(
                                x: .value("距離", point.distanceMeters),
                                y: .value("ドロップ(cm)", point.dropCM)
                            )
                            .foregroundStyle(.red)
                            .interpolationMethod(.catmullRom)
                        }

                        RuleMark(x: .value("ターゲット", targetDistance))
                            .lineStyle(StrokeStyle(lineWidth: 1, dash: [5]))
                            .foregroundStyle(.gray)
                    }
                    .chartXScale(domain: minDistance...maxDistance)
                    .chartYScale(domain: .automatic(includesZero: false, reversed: true))
                    .chartXAxisLabel("直線距離 (m)")
                    .chartYAxisLabel("落下量 (cm)")
                    .frame(height: 160)
                }

                // 3. BIJIA R600 測定値入力
                Section(header: Text("距離計の入力 (BIJIA R600)")) {
                    VStack(alignment: .leading) {
                        HStack {
                            Text("直線距離")
                            Spacer()
                            Text("\(Int(targetDistance)) m")
                                .bold().foregroundColor(.green)
                        }
                        Slider(value: $targetDistance, in: minDistance...maxDistance, step: 1)
                    }

                    VStack(alignment: .leading) {
                        HStack {
                            Text("打ち上げ/打ち下ろし角度")
                            Spacer()
                            Text("\(Int(shootingAngle))°")
                                .bold().foregroundColor(.orange)
                        }
                        Slider(value: $shootingAngle, in: -45...45, step: 1)
                    }
                }

                // 4. CHE-WD1 風速計・環境値入力
                Section(header: Text("環境の入力 (CHE-WD1 / 気圧)")) {
                    Picker("風の吹いてくる方向 (獲物=12時)", selection: $windClockHour) {
                        ForEach(1...12, id: \.self) { hour in
                            Text("\(hour) 時の方向").tag(hour)
                        }
                    }

                    VStack(alignment: .leading) {
                        HStack {
                            Text("風速 (CHE-WD1)")
                            Spacer()
                            Text(String(format: "%.1f m/s", windSpeedMPS))
                                .bold().foregroundColor(.blue)
                        }
                        Slider(value: $windSpeedMPS, in: 0...15, step: 0.1)
                    }

                    HStack {
                        Text("気温 (CHE-WD1)")
                        Spacer()
                        TextField("15", value: $temperatureC, format: .number)
                            .keyboardType(.numbersAndPunctuation)
                            .multilineTextAlignment(.trailing)
                            .frame(width: 60)
                        Text("℃").foregroundColor(.secondary)
                    }

                    HStack {
                        Text("現地気圧")
                        Spacer()
                        TextField("1013", value: $pressureHPA, format: .number)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                            .frame(width: 60)
                        Text("hPa").foregroundColor(.secondary)
                    }
                }

                // 5. 銃・弾薬仕様
                Section(header: Text("銃・ペレットの設定")) {
                    HStack {
                        Text("初速 (FPS)")
                        Spacer()
                        TextField("880", text: $velocityFPS)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                    }
                    HStack {
                        Text("弾重 (Grains)")
                        Spacer()
                        TextField("44.75", text: $weightGrains)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                    }
                    HStack {
                        Text("弾丸係数 (BC)")
                        Spacer()
                        TextField("0.045", text: $bc)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                    }
                    HStack {
                        Text("ゼロイン距離 (m)")
                        Spacer()
                        TextField("50", text: $zeroDistance)
                            .keyboardType(.numberPad)
                            .multilineTextAlignment(.trailing)
                    }
                }
            }
            .navigationTitle("PCP Ballistics")
        }
    }

    // MARK: 表示用テキスト
    private var elevationCMText: String {
        guard currentResult.isValid else { return "—" }
        return String(format: "%.1f cm", currentResult.dropCM)
    }

    private var elevationMILText: String {
        guard currentResult.isValid else { return "— MIL" }
        return String(format: "%@ %.2f MIL",
                      currentResult.elevationHoldDirection,
                      abs(currentResult.dropMIL))
    }

    private var windageCMText: String {
        guard currentResult.isValid else { return "—" }
        return String(format: "%@へ %.1f cm",
                      currentResult.windageDriftDirection,
                      abs(currentResult.windageCM))
    }

    private var windageMILText: String {
        guard currentResult.isValid else { return "— MIL" }
        return String(format: "%@ %.2f MIL",
                      currentResult.windageHoldDirection,
                      abs(currentResult.windageMIL))
    }
}

// MARK: - 3. プレビュー用
#Preview {
    ContentView()
}
