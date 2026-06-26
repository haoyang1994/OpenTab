const FIX_TAGS = {
  '1': 'Account',
  '2': 'AdvId',
  '3': 'AdvRefID',
  '4': 'AdvSide',
  '5': 'AdvTransType',
  '6': 'AvgPx',
  '7': 'BeginSeqNo',
  '8': 'BeginString',
  '9': 'BodyLength',
  '10': 'CheckSum',
  '11': 'ClOrdID',
  '12': 'Commission',
  '13': 'CommType',
  '14': 'CumQty',
  '15': 'Currency',
  '16': 'EndSeqNo',
  '17': 'ExecID',
  '18': 'ExecInst',
  '19': 'ExecRefID',
  '20': 'ExecTransType',
  '21': 'HandlInst',
  '22': 'SecurityIDSource',
  '23': 'IOIID',
  '24': 'IOIOthSvc',
  '25': 'IOIQltyInd',
  '26': 'IOIRefID',
  '27': 'IOIQty',
  '28': 'IOITransType',
  '29': 'LastCapacity',
  '30': 'LastMkt',
  '31': 'LastPx',
  '32': 'LastQty',
  '33': 'NoLinesOfText',
  '34': 'MsgSeqNum',
  '35': 'MsgType',
  '36': 'NewSeqNo',
  '37': 'OrderID',
  '38': 'OrderQty',
  '39': 'OrdStatus',
  '40': 'OrdType',
  '41': 'OrigClOrdID',
  '42': 'OrigTime',
  '43': 'PossDupFlag',
  '44': 'Price',
  '45': 'RefSeqNum',
  '46': 'RelatdSym',
  '47': 'Rule80A',
  '48': 'SecurityID',
  '49': 'SenderCompID',
  '50': 'SenderSubID',
  '51': 'SendingDate',
  '52': 'SendingTime',
  '53': 'Quantity',
  '54': 'Side',
  '55': 'Symbol',
  '56': 'TargetCompID',
  '57': 'TargetSubID',
  '58': 'Text',
  '59': 'TimeInForce',
  '60': 'TransactTime',
  '61': 'Urgency',
  '62': 'ValidUntilTime',
  '63': 'SettlType',
  '64': 'SettlDate',
  '65': 'SymbolSfx',
  '66': 'ListID',
  '67': 'ListSeqNo',
  '68': 'TotNoOrders',
  '69': 'ListExecInst',
  '70': 'AllocID',
  '71': 'AllocTransType',
  '72': 'RefAllocID',
  '73': 'NoOrders',
  '74': 'AvgPxPrecision',
  '75': 'TradeDate',
  '76': 'ExecBroker',
  '77': 'PositionEffect',
  '78': 'NoAllocs',
  '79': 'AllocAccount',
  '80': 'AllocQty',
  '81': 'ProcessCode',
  '82': 'NoRpts',
  '83': 'RptSeq',
  '84': 'CxlQty',
  '85': 'NoDlvyInst',
  '86': 'DlvyInst',
  '87': 'AllocStatus',
  '88': 'AllocRejCode',
  '89': 'Signature',
  '90': 'SecureDataLen',
  '91': 'SecureData',
  '92': 'BrokerOfCredit',
  '93': 'SignatureLength',
  '94': 'EmailType',
  '95': 'RawDataLength',
  '96': 'RawData',
  '97': 'PossResend',
  '98': 'EncryptMethod',
  '99': 'StopPx',
  '100': 'ExDestination',
  '102': 'CxlRejReason',
  '103': 'OrdRejReason',
  '104': 'IOIQualifier',
  '105': 'WaveNo',
  '106': 'Issuer',
  '107': 'SecurityDesc',
  '108': 'HeartBtInt',
  '109': 'ClientID',
  '110': 'MinQty',
  '111': 'MaxFloor',
  '112': 'TestReqID',
  '113': 'ReportToExch',
  '114': 'LocateReqd',
  '115': 'OnBehalfOfCompID',
  '116': 'OnBehalfOfSubID',
  '117': 'QuoteID',
  '118': 'NetMoney',
  '119': 'SettlCurrAmt',
  '120': 'SettlCurrency',
  '121': 'ForexReq',
  '122': 'OrigSendingTime',
  '123': 'GapFillFlag',
  '124': 'NoExecs',
  '125': 'CxlType',
  '126': 'ExpireTime',
  '127': 'DKReason',
  '128': 'DeliverToCompID',
  '129': 'DeliverToSubID',
  '130': 'IOINaturalFlag',
  '131': 'QuoteReqID',
  '132': 'BidPx',
  '133': 'OfferPx',
  '134': 'BidSize',
  '135': 'OfferSize',
  '136': 'NoMiscFees',
  '137': 'MiscFeeAmt',
  '138': 'MiscFeeCurr',
  '139': 'MiscFeeType',
  '140': 'PrevClosePx',
  '141': 'ResetSeqNumFlag',
  '142': 'SenderLocationID',
  '143': 'TargetLocationID',
  '144': 'OnBehalfOfLocationID',
  '145': 'DeliverToLocationID',
  '146': 'NoRelatedSym',
  '147': 'Subject',
  '148': 'Headline',
  '149': 'URLLink',
  '150': 'ExecType',
  '151': 'LeavesQty',
  '152': 'CashOrderQty',
  '153': 'AllocAvgPx',
  '154': 'AllocNetMoney',
  '155': 'SettlCurrFxRate',
  '156': 'SettlCurrFxRateCalc',
  '157': 'NumDaysInterest',
  '158': 'AccruedInterestRate',
  '159': 'AccruedInterestAmt',
  '160': 'SettlInstMode',
  '161': 'AllocText',
  '162': 'SettlInstID',
  '163': 'SettlInstTransType',
  '164': 'EmailThreadID',
  '165': 'SettlInstSource',
  '166': 'SettlLocation',
  '167': 'SecurityType',
  '168': 'EffectiveTime',
  '169': 'StandInstDbType',
  '170': 'StandInstDbName',
  '171': 'StandInstDbID',
  '172': 'SettlDeliveryType',
  '173': 'SettlDepositoryCode',
  '174': 'SettlBrkrCode',
  '175': 'SettlInstCode',
  '176': 'SecuritySettlAgentName',
  '177': 'SecuritySettlAgentCode',
  '178': 'SecuritySettlAgentAcctNum',
  '179': 'SecuritySettlAgentAcctName',
  '180': 'SecuritySettlAgentContactName',
  '181': 'SecuritySettlAgentContactPhone',
  '182': 'CashSettlAgentName',
  '183': 'CashSettlAgentCode',
  '184': 'CashSettlAgentAcctNum',
  '185': 'CashSettlAgentAcctName',
  '186': 'CashSettlAgentContactName',
  '187': 'CashSettlAgentContactPhone',
  '188': 'BidSpotRate',
  '189': 'BidForwardPoints',
  '190': 'OfferSpotRate',
  '191': 'OfferForwardPoints',
  '192': 'OrderQty2',
  '193': 'SettlDate2',
  '194': 'LastSpotRate',
  '195': 'LastForwardPoints',
  '196': 'AllocLinkID',
  '197': 'AllocLinkType',
  '198': 'SecondaryOrderID',
  '199': 'NoIOIQualifiers',
  '200': 'MaturityMonthYear',
  '201': 'PutOrCall',
  '202': 'StrikePrice',
  '203': 'CoveredOrUncovered',
  '204': 'CustomerOrFirm',
  '205': 'MaturityDay',
  '206': 'OptAttribute',
  '207': 'SecurityExchange',
  '208': 'NotifyBrokerOfCredit',
  '209': 'AllocHandlInst',
  '210': 'MaxShow',
  '211': 'PegOffsetValue',
  '212': 'XmlDataLen',
  '213': 'XmlData',
  '214': 'SettlInstRefID',
  '215': 'NoRoutingIDs',
  '216': 'RoutingType',
  '217': 'RoutingID',
  '218': 'Spread',
  '219': 'Benchmark',
  '220': 'BenchmarkCurveCurrency',
  '221': 'BenchmarkCurveName',
  '222': 'BenchmarkCurvePoint',
  '223': 'CouponRate',
  '224': 'CouponPaymentDate',
  '225': 'IssueDate',
  '226': 'RepurchaseTerm',
  '227': 'RepurchaseRate',
  '228': 'Factor',
  '229': 'TradeOriginationDate',
  '230': 'ExDate',
  '231': 'ContractMultiplier',
  '232': 'NoStipulations',
  '233': 'StipulationType',
  '234': 'StipulationValue',
  '235': 'YieldType',
  '236': 'Yield',
  '237': 'TotalTakedown',
  '238': 'Concession',
  '239': 'RepoCollateralSecurityType',
  '240': 'RedemptionDate',
  '241': 'UnderlyingCouponPaymentDate',
  '242': 'UnderlyingIssueDate',
  '243': 'UnderlyingRepoCollateralSecurityType',
  '244': 'UnderlyingRepurchaseTerm',
  '245': 'UnderlyingRepurchaseRate',
  '246': 'UnderlyingFactor',
  '247': 'UnderlyingRedemptionDate',
  '248': 'LegCouponPaymentDate',
  '249': 'LegIssueDate',
  '250': 'LegRepoCollateralSecurityType',
  '251': 'LegRepurchaseTerm',
  '252': 'LegRepurchaseRate',
  '253': 'LegFactor',
  '254': 'LegRedemptionDate',
  '255': 'CreditRating',
  '256': 'UnderlyingCreditRating',
  '257': 'LegCreditRating',
  '258': 'TradedFlatSwitch',
  '259': 'BasisFeatureDate',
  '260': 'BasisFeaturePrice',
  '262': 'MDReqID',
  '263': 'SubscriptionRequestType',
  '264': 'MarketDepth',
  '265': 'MDUpdateType',
  '266': 'AggregatedBook',
  '267': 'NoMDEntryTypes',
  '268': 'NoMDEntries',
  '269': 'MDEntryType',
  '270': 'MDEntryPx',
  '271': 'MDEntrySize',
  '272': 'MDEntryDate',
  '273': 'MDEntryTime',
  '274': 'TickDirection',
  '275': 'MDMkt',
  '276': 'QuoteCondition',
  '277': 'TradeCondition',
  '278': 'MDEntryID',
  '279': 'MDUpdateAction',
  '280': 'MDEntryRefID',
  '281': 'MDReqRejReason',
  '282': 'MDEntryOriginator',
  '283': 'LocationID',
  '284': 'DeskID',
  '285': 'DeleteReason',
  '286': 'OpenCloseSettlFlag',
  '287': 'SellerDays',
  '288': 'MDEntryBuyer',
  '289': 'MDEntrySeller',
  '290': 'MDEntryPositionNo',
  '291': 'FinancialStatus',
  '292': 'CorporateAction',
  '293': 'DefBidSize',
  '294': 'DefOfferSize',
  '295': 'NoQuoteEntries',
  '296': 'NoQuoteSets',
  '297': 'QuoteStatus',
  '298': 'QuoteCancelType',
  '299': 'QuoteEntryID',
  '300': 'QuoteRejectReason',
  '301': 'QuoteResponseLevel',
  '302': 'QuoteSetID',
  '303': 'QuoteRequestType',
  '304': 'TotNoQuoteEntries',
  '305': 'UnderlyingSecurityIDSource',
  '306': 'UnderlyingIssuer',
  '307': 'UnderlyingSecurityDesc',
  '308': 'UnderlyingSecurityExchange',
  '309': 'UnderlyingSecurityID',
  '310': 'UnderlyingSecurityType',
  '311': 'UnderlyingSymbol',
  '312': 'UnderlyingSymbolSfx',
  '313': 'UnderlyingMaturityMonthYear',
  '314': 'UnderlyingMaturityDay',
  '315': 'UnderlyingPutOrCall',
  '316': 'UnderlyingStrikePrice',
  '317': 'UnderlyingOptAttribute',
  '318': 'UnderlyingCurrency',
  '319': 'RatioQty',
  '320': 'SecurityReqID',
  '321': 'SecurityRequestType',
  '322': 'SecurityResponseID',
  '323': 'SecurityResponseType',
  '324': 'SecurityStatusReqID',
  '325': 'UnsolicitedIndicator',
  '326': 'SecurityTradingStatus',
  '327': 'HaltReasonInt',
  '328': 'InViewOfCommon',
  '329': 'DueToRelated',
  '330': 'BuyVolume',
  '331': 'SellVolume',
  '332': 'HighPx',
  '333': 'LowPx',
  '334': 'Adjustment',
  '335': 'TradSesReqID',
  '336': 'TradingSessionID',
  '337': 'ContraTrader',
  '338': 'TradSesMethod',
  '339': 'TradSesMode',
  '340': 'TradSesStatus',
  '341': 'TradSesStartTime',
  '342': 'TradSesOpenTime',
  '343': 'TradSesPreCloseTime',
  '344': 'TradSesCloseTime',
  '345': 'TradSesEndTime',
  '346': 'NumberOfOrders',
  '347': 'MessageEncoding',
  '348': 'EncodedIssuerLen',
  '349': 'EncodedIssuer',
  '350': 'EncodedSecurityDescLen',
  '351': 'EncodedSecurityDesc',
  '352': 'EncodedListExecInstLen',
  '353': 'EncodedListExecInst',
  '354': 'EncodedTextLen',
  '355': 'EncodedText',
  '356': 'EncodedSubjectLen',
  '357': 'EncodedSubject',
  '358': 'EncodedHeadlineLen',
  '359': 'EncodedHeadline',
  '360': 'EncodedAllocTextLen',
  '361': 'EncodedAllocText',
  '362': 'EncodedUnderlyingIssuerLen',
  '363': 'EncodedUnderlyingIssuer',
  '364': 'EncodedUnderlyingSecurityDescLen',
  '365': 'EncodedUnderlyingSecurityDesc',
  '366': 'AllocPrice',
  '367': 'QuoteSetValidUntilTime',
  '368': 'QuoteEntryRejectReason',
  '369': 'LastMsgSeqNumProcessed',
  '370': 'OnBehalfOfSendingTime',
  '371': 'RefTagID',
  '372': 'RefMsgType',
  '373': 'SessionRejectReason',
  '374': 'BidRequestTransType',
  '375': 'ContraBroker',
  '376': 'ComplianceID',
  '377': 'SolicitedFlag',
  '378': 'ExecRestatementReason',
  '379': 'BusinessRejectRefID',
  '380': 'BusinessRejectReason',
  '381': 'GrossTradeAmt',
  '382': 'NoContraBrokers',
  '383': 'MaxMessageSize',
  '384': 'NoMsgTypes',
  '385': 'MsgDirection',
  '386': 'NoTradingSessions',
  '387': 'TotalVolumeTraded',
  '388': 'DiscretionInst',
  '389': 'DiscretionOffsetValue',
  '390': 'BidID',
  '391': 'ClientBidID',
  '392': 'ListName',
  '393': 'TotNoRelatedSym',
  '394': 'BidType',
  '395': 'NumTickets',
  '396': 'SideValue1',
  '397': 'SideValue2',
  '398': 'NoBidDescriptors',
  '399': 'BidDescriptorType',
  '400': 'BidDescriptor',
  '401': 'SideValueInd',
  '402': 'LiquidityPctLow',
  '403': 'LiquidityPctHigh',
  '404': 'LiquidityValue',
  '405': 'EFPTrackingError',
  '406': 'FairValue',
  '407': 'OutsideIndexPct',
  '408': 'ValueOfFutures',
  '409': 'LiquidityIndType',
  '410': 'WtAverageLiquidity',
  '411': 'ExchangeForPhysical',
  '412': 'OutMainCntryUIndex',
  '413': 'CrossPercent',
  '414': 'ProgRptReqs',
  '415': 'ProgPeriodInterval',
  '416': 'IncTaxInd',
  '417': 'NumBidders',
  '418': 'BidTradeType',
  '419': 'BasisPxType',
  '420': 'NoBidComponents',
  '421': 'Country',
  '422': 'TotNoStrikes',
  '423': 'PriceType',
  '424': 'DayOrderQty',
  '425': 'DayCumQty',
  '426': 'DayAvgPx',
  '427': 'GTBookingInst',
  '428': 'NoStrikes',
  '429': 'ListStatusType',
  '430': 'NetGrossInd',
  '431': 'ListOrderStatus',
  '432': 'ExpireDate',
  '433': 'ListExecInstType',
  '434': 'CxlRejResponseTo',
  '435': 'UnderlyingCouponRate',
  '436': 'UnderlyingContractMultiplier',
  '437': 'ContraTradeQty',
  '438': 'ContraTradeTime',
  '439': 'ClearingFirm',
  '440': 'ClearingAccount',
  '441': 'LiquidityNumSecurities',
  '442': 'MultiLegReportingType',
  '443': 'StrikeTime',
  '444': 'ListStatusText',
  '445': 'EncodedListStatusTextLen',
  '446': 'EncodedListStatusText',
  '447': 'PartyIDSource',
  '448': 'PartyID',
  '449': 'TotalVolumeTradedDate',
  '450': 'TotalVolumeTradedTime',
  '451': 'NetChgPrevDay',
  '452': 'PartyRole',
  '453': 'NoPartyIDs',
  '454': 'NoSecurityAltID',
  '455': 'SecurityAltID',
  '456': 'SecurityAltIDSource',
  '457': 'NoUnderlyingSecurityAltID',
  '458': 'UnderlyingSecurityAltID',
  '459': 'UnderlyingSecurityAltIDSource',
  '460': 'Product',
  '461': 'CFICode',
  '462': 'UnderlyingProduct',
  '463': 'UnderlyingCFICode',
  '464': 'TestMessageIndicator',
  '465': 'QuantityType',
  '466': 'BookingRefID',
  '467': 'IndividualAllocID',
  '468': 'RoundingDirection',
  '469': 'RoundingModulus',
  '470': 'CountryOfIssue',
  '471': 'StateOrProvinceOfIssue',
  '472': 'LocaleOfIssue',
  '473': 'NoRegistDtls',
  '474': 'MailingDtls',
  '475': 'InvestorCountryOfResidence',
  '476': 'PaymentRef',
  '477': 'DistribPaymentMethod',
  '478': 'CashDistribCurr',
  '479': 'CommCurrency',
  '480': 'CancellationRights',
  '481': 'MoneyLaunderingStatus',
  '482': 'MailingInst',
  '483': 'TransBkdTime',
  '484': 'ExecPriceType',
  '485': 'ExecPriceAdjustment',
  '486': 'DateOfBirth',
  '487': 'TradeReportTransType',
  '488': 'CardHolderName',
  '489': 'CardNumber',
  '490': 'CardExpDate',
  '491': 'CardIssNum',
  '492': 'PaymentMethod',
  '493': 'RegistAcctType',
  '494': 'Designation',
  '495': 'TaxAdvantageType',
  '496': 'RegistRejReasonText',
  '497': 'FundRenewWaiv',
  '498': 'CashDistribAgentName',
  '499': 'CashDistribAgentCode',
  '500': 'CashDistribAgentAcctNumber',
  '501': 'CashDistribPayRef',
  '502': 'CashDistribAgentAcctName',
  '503': 'CardStartDate',
  '504': 'PaymentDate',
  '505': 'PaymentRemitterID',
  '506': 'RegistStatus',
  '507': 'RegistRejReasonCode',
  '508': 'RegistRefID',
  '509': 'RegistDtls',
  '510': 'NoDistribInsts',
  '511': 'RegistEmail',
  '512': 'DistribPercentage',
  '513': 'RegistID',
  '514': 'RegistTransType',
  '515': 'ExecValuationPoint',
  '516': 'OrderPercent',
  '517': 'OwnershipType',
  '518': 'NoContAmts',
  '519': 'ContAmtType',
  '520': 'ContAmtValue',
  '521': 'ContAmtCurr',
  '522': 'OwnerType',
  '523': 'PartySubID',
  '524': 'NestedPartyID',
  '525': 'NestedPartyIDSource',
  '526': 'SecondaryClOrdID',
  '527': 'SecondaryExecID',
  '528': 'OrderCapacity',
  '529': 'OrderRestrictions',
  '530': 'MassCancelRequestType',
  '531': 'MassCancelResponse',
  '532': 'MassCancelRejectReason',
  '533': 'TotalAffectedOrders',
  '534': 'NoAffectedOrders',
  '535': 'AffectedOrderID',
  '536': 'AffectedSecondaryOrderID',
  '537': 'QuoteType',
  '538': 'NestedPartyRole',
  '539': 'NoNestedPartyIDs',
  '540': 'TotalAccruedInterestAmt',
  '541': 'MaturityDate',
  '542': 'UnderlyingMaturityDate',
  '543': 'InstrRegistry',
  '544': 'CashMargin',
  '545': 'NestedPartySubID',
  '546': 'Scope',
  '547': 'MDImplicitDelete',
  '548': 'CrossID',
  '549': 'CrossType',
  '550': 'CrossPrioritization',
  '551': 'OrigCrossID',
  '552': 'NoSides',
  '553': 'Username',
  '554': 'Password',
  '555': 'NoLegs',
  '556': 'LegCurrency',
  '557': 'TotNoSecurityTypes',
  '558': 'NoSecurityTypes',
  '559': 'SecurityListRequestType',
  '560': 'SecurityRequestResult',
  '561': 'RoundLot',
  '562': 'MinTradeVol',
  '563': 'MultiLegRptTypeReq',
  '564': 'LegPositionEffect',
  '565': 'LegCoveredOrUncovered',
  '566': 'LegPrice',
  '567': 'TradSesStatusRejReason',
  '568': 'TradeRequestID',
  '569': 'TradeRequestType',
  '570': 'PreviouslyReported',
  '571': 'TradeReportID',
  '572': 'TradeReportRefID',
  '573': 'MatchStatus',
  '574': 'MatchType',
  '575': 'OddLot',
  '576': 'NoClearingInstructions',
  '577': 'ClearingInstruction',
  '578': 'TradeInputSource',
  '579': 'TradeInputDevice',
  '580': 'NoDates',
  '581': 'AccountType',
  '582': 'CustOrderCapacity',
  '583': 'ClOrdLinkID',
  '584': 'MassStatusReqID',
  '585': 'MassStatusReqType',
  '586': 'OrigOrdModTime',
  '587': 'LegSettlType',
  '588': 'LegSettlDate',
  '600': 'LegSymbol'
};

const MSG_TYPE_NAMES = {
  '0': 'Heartbeat',
  '1': 'TestRequest',
  '2': 'ResendRequest',
  '3': 'Reject',
  '4': 'SequenceReset',
  '5': 'Logout',
  '6': 'IOI',
  '7': 'Advertisement',
  '8': 'ExecutionReport',
  '9': 'OrderCancelReject',
  'A': 'Logon',
  'B': 'News',
  'C': 'Email',
  'D': 'NewOrderSingle',
  'E': 'NewOrderList',
  'F': 'OrderCancelRequest',
  'G': 'OrderCancelReplaceRequest',
  'H': 'OrderStatusRequest',
  'J': 'AllocationInstruction',
  'K': 'ListCancelRequest',
  'L': 'ListExecute',
  'M': 'ListStatusRequest',
  'N': 'ListStatus',
  'P': 'AllocationInstructionACK',
  'Q': 'DontKnowTrade',
  'R': 'QuoteRequest',
  'S': 'Quote',
  'T': 'SettlementInstructions',
  'V': 'MarketDataRequest',
  'W': 'MarketDataSnapshotFullRefresh',
  'X': 'MarketDataIncrementalRefresh',
  'Y': 'MarketDataRequestReject',
  'Z': 'QuoteCancel',
  'a': 'QuoteStatusRequest',
  'b': 'MassQuoteAcknowledgement',
  'c': 'SecurityDefinitionRequest',
  'd': 'SecurityDefinition',
  'e': 'SecurityStatusRequest',
  'f': 'SecurityStatus',
  'g': 'TradingSessionStatusRequest',
  'h': 'TradingSessionStatus',
  'i': 'MassQuote',
  'j': 'BusinessMessageReject',
  'k': 'BidRequest',
  'l': 'BidResponse',
  'm': 'ListStrikePrice',
  'n': 'XML_NON_FIX',
  'o': 'RegistrationInstructions',
  'p': 'RegistrationInstructionsResponse',
  'q': 'OrderMassCancelRequest',
  'r': 'OrderMassCancelReport',
  's': 'NewOrderCross',
  't': 'CrossOrderCancelReplaceRequest',
  'u': 'CrossOrderCancelRequest',
  'v': 'SecurityTypesRequest',
  'w': 'SecurityTypes',
  'x': 'SecurityListRequest',
  'y': 'SecurityList',
  'z': 'DerivativeSecurityListRequest',
  'AA': 'DerivativeSecurityList',
  'AB': 'NewOrderMultiLeg',
  'AC': 'MultiLegOrderCancelReplace',
  'AD': 'TradeCaptureReportRequest',
  'AE': 'TradeCaptureReport',
  'AF': 'OrderMassStatusRequest',
  'AG': 'QuoteRequestReject',
  'AH': 'RFQRequest',
  'AI': 'QuoteStatusReport',
  'AJ': 'QuoteResponse',
  'AK': 'Confirmation',
  'AL': 'PositionMaintenanceRequest',
  'AM': 'PositionMaintenanceReport',
  'AN': 'RequestForPositions',
  'AO': 'RequestForPositionsAck',
  'AP': 'PositionReport',
  'AQ': 'TradeCaptureReportRequestAck',
  'AR': 'TradeCaptureReportAck',
  'AS': 'AllocationReport',
  'AT': 'AllocationReportAck',
  'AU': 'ConfirmationAck',
  'AV': 'SettlementInstructionRequest',
  'AW': 'AssignmentReport',
  'AX': 'CollateralRequest',
  'AY': 'CollateralAssignment',
  'AZ': 'CollateralResponse',
  'BA': 'CollateralReport',
  'BB': 'CollateralInquiry',
  'BC': 'NetworkCounterpartySystemStatusRequest',
  'BD': 'NetworkCounterpartySystemStatusResponse',
  'BE': 'UserRequest',
  'BF': 'UserResponse',
  'BG': 'CollateralInquiryAck',
  'BH': 'ConfirmationRequest',
  'BI': 'TradingSessionListRequest',
  'BJ': 'TradingSessionList',
  'BK': 'SecurityListUpdateReport',
  'BL': 'AdjustedPositionReport',
  'BM': 'AllocationInstructionAlert',
  'BN': 'ExecutionAcknowledgement',
  'BO': 'ContraryIntentionReport',
  'BP': 'SecurityDefinitionUpdateReport',
  'BQ': 'SettlementObligationReport',
  'BR': 'DerivativeSecurityListUpdateReport',
  'BS': 'TradingSessionListUpdateReport',
  'BT': 'MarketDefinitionRequest',
  'BU': 'MarketDefinition',
  'BV': 'MarketDefinitionUpdateReport',
  'BW': 'ApplicationMessageRequest',
  'BX': 'ApplicationMessageRequestAck',
  'BY': 'ApplicationMessageReport',
  'BZ': 'OrderMassActionReport',
  'CA': 'OrderMassActionRequest',
  'CB': 'UserNotification',
  'CC': 'StreamAssignmentRequest',
  'CD': 'StreamAssignmentReport',
  'CE': 'StreamAssignmentReportAck',
  'CF': 'PartyDetailsListRequest',
  'CG': 'PartyDetailsListReport'
};

const FIX_VALUES = {
  '1': { 'B': 'BUY', 'S': 'SELL', 'T': 'TRADE', 'X': 'CROSS' },
  '5': { 'C': 'CANCEL', 'N': 'NEW', 'R': 'REPLACE' },
  '18': { '1': 'AUTOMATED_EXECUTION_ORDER_PRIVATE', '2': 'AUTOMATED_EXECUTION_ORDER_PUBLIC', '3': 'MANUAL_ORDER_BEST_EXECUTION' },
  '21': { '1': 'AUTOMATED_EXECUTION_ORDER_PRIVATE', '2': 'AUTOMATED_EXECUTION_ORDER_PUBLIC', '3': 'MANUAL_ORDER_BEST_EXECUTION' },
  '28': { 'C': 'CANCEL', 'N': 'NEW', 'R': 'REPLACE' },
  '29': { '1': 'AGENT', '2': 'CROSS_AS_AGENT', '3': 'CROSS_AS_PRINCIPAL', '4': 'PRINCIPAL' },
  '35': MSG_TYPE_NAMES,
  '37': { '0': 'NEW', '1': 'PARTIALLY_FILLED', '2': 'FILLED', '3': 'DONE_FOR_DAY', '4': 'CANCELED', '5': 'REPLACED', '6': 'PENDING_CANCEL', '7': 'STOPPED', '8': 'REJECTED', '9': 'SUSPENDED', 'A': 'PENDING_NEW', 'B': 'CALCULATED', 'C': 'EXPIRED', 'D': 'ACCEPTED_FOR_BIDDING', 'E': 'PENDING_REPLACE' },
  '38': { '0': 'NEW', '1': 'PARTIALLY_FILLED', '2': 'FILLED', '3': 'DONE_FOR_DAY', '4': 'CANCELED', '5': 'REPLACED', '6': 'PENDING_CANCEL', '7': 'STOPPED', '8': 'REJECTED', '9': 'SUSPENDED', 'A': 'PENDING_NEW', 'B': 'CALCULATED', 'C': 'EXPIRED' },
  '39': { '0': 'NEW', '1': 'PARTIALLY_FILLED', '2': 'FILLED', '3': 'DONE_FOR_DAY', '4': 'CANCELED', '5': 'REPLACED', '6': 'PENDING_CANCEL', '7': 'STOPPED', '8': 'REJECTED', '9': 'SUSPENDED', 'A': 'PENDING_NEW', 'B': 'CALCULATED', 'C': 'EXPIRED', 'D': 'ACCEPTED_FOR_BIDDING', 'E': 'PENDING_REPLACE' },
  '40': { '1': 'MARKET', '2': 'LIMIT', '3': 'STOP', '4': 'STOP_LIMIT', '5': 'MARKET_ON_CLOSE', '6': 'WITH_OR_WITHOUT', '7': 'LIMIT_OR_BETTER', '8': 'LIMIT_WITH_OR_WITHOUT', '9': 'ON_BASIS', 'A': 'ON_CLOSE', 'B': 'LIMIT_ON_CLOSE', 'C': 'FOREX_MARKET', 'D': 'PREVIOUSLY_QUOTED', 'E': 'PREVIOUSLY_INDICATED', 'F': 'FOREX_LIMIT', 'G': 'FOREX_SWAP', 'I': 'FUNARI', 'J': 'MARKET_IF_TOUCHED', 'P': 'PEGGED' },
  '44': { '1': 'DAY', '2': 'GOOD_TILL_CANCEL', '3': 'AT_THE_OPENING', '4': 'IMMEDIATE_OR_CANCEL', '5': 'FILL_OR_KILL', '6': 'GOOD_TILL_CROSSING', '7': 'GOOD_TILL_DATE', '8': 'AT_THE_CLOSE', '9': 'AT_CROSSING' },
  '47': { 'A': 'AGENCY_SINGLE_ORDER', 'P': 'PRINCIPAL', 'R': 'RISKLESS_PRINCIPAL' },
  '54': { '1': 'BUY', '2': 'SELL', '3': 'BUY_MINUS', '4': 'SELL_PLUS', '5': 'SELL_SHORT', '6': 'SELL_SHORT_EXEMPT', '7': 'UNDISCLOSED', '8': 'CROSS', '9': 'CROSS_SHORT', 'A': 'CROSS_SHORT_EXEMPT', 'B': 'AS_DEFINED', 'C': 'OPPOSITE', 'D': 'SUBSCRIBE', 'E': 'REDEEM', 'F': 'LEND', 'G': 'BORROW' },
  '55': { '0': 'DAY', '1': 'GOOD_TILL_CANCEL', '2': 'AT_THE_OPENING', '3': 'IMMEDIATE_OR_CANCEL', '4': 'FILL_OR_KILL', '5': 'GOOD_TILL_CROSSING', '6': 'GOOD_TILL_DATE', '7': 'AT_THE_CLOSE' },
  '59': { '0': 'DAY', '1': 'GOOD_TILL_CANCEL', '2': 'AT_THE_OPENING', '3': 'IMMEDIATE_OR_CANCEL', '4': 'FILL_OR_KILL', '5': 'GOOD_TILL_CROSSING', '6': 'GOOD_TILL_DATE', '7': 'AT_THE_CLOSE' },
  '60': { '0': 'NORMAL', '1': 'FLASH', '2': 'BACKGROUND' },
  '63': { '0': 'REGULAR', '1': 'CASH', '2': 'NEXT_DAY', '3': 'T_PLUS_2', '4': 'T_PLUS_3', '5': 'T_PLUS_4', '6': 'FUTURE', '7': 'WHEN_AND_IF_ISSUED', '8': 'SELLERS_OPTION' },
  '75': { '0': 'NEW', '1': 'CANCEL', '2': 'REPLACE' },
  '87': { '0': 'ACCEPTED', '1': 'BLOCK_LEVEL_REJECT', '2': 'ACCOUNT_LEVEL_REJECT', '3': 'RECEIVED', '4': 'INCOMPLETE', '5': 'REJECTED_BY_INTERMEDIARY', '6': 'ALLOCATION_PENDING', '7': 'REVERSED' },
  '88': { '0': 'UNKNOWN_ACCOUNT', '1': 'INCORRECT_QUANTITY', '2': 'INCORRECT_AVERAGE_PRICE', '3': 'UNKNOWN_EXECUTING_BROKER', '4': 'COMMISSION_DIFFERENCE', '5': 'UNKNOWN_ORDER_ID', '6': 'UNKNOWN_LIST_ID', '8': 'INCORRECT_ALLOCATED_QUANTITY', '9': 'CALCULATION_DIFFERENCE', '99': 'OTHER' },
  '98': { '0': 'NONE', '1': 'PKCS_1', '2': 'DES', '3': 'PKCS_3', '4': 'PGP_4', '5': 'PGP_5', '6': 'PEM' },
  '99': { '0': 'TOO_LATE_TO_CANCEL', '1': 'UNKNOWN_ORDER', '2': 'BROKER', '3': 'ORDER_ALREADY_PENDING', '4': 'UNABLE_TO_PROCESS', '5': 'ORIGORDMODTIME', '6': 'DUPLICATE_CLORDID', '7': 'PRICE_EXCEEDS_CURRENT_PRICE', '99': 'OTHER' },
  '102': { '0': 'TOO_LATE_TO_CANCEL', '1': 'UNKNOWN_ORDER', '2': 'BROKER', '3': 'ORDER_ALREADY_PENDING', '4': 'UNABLE_TO_PROCESS', '5': 'ORIGORDMODTIME', '6': 'DUPLICATE_CLORDID', '99': 'OTHER' },
  '103': { '0': 'BROKER', '1': 'UNKNOWN_SYMBOL', '2': 'EXCHANGE_CLOSED', '3': 'ORDER_EXCEEDS_LIMIT', '4': 'TOO_LATE_TO_ENTER', '5': 'UNKNOWN_ORDER', '6': 'DUPLICATE_ORDER', '7': 'DUPLICATE_VERBAL', '8': 'STALE_ORDER', '99': 'OTHER' },
  '104': { 'A': 'ALL_OR_NONE', 'B': 'MARKET_ON_CLOSE', 'L': 'LIMIT', 'O': 'AT_THE_OPEN', 'P': 'TAKING_A_POSITION', 'Q': 'AT_THE_MARKET', 'R': 'READY_TO_TRADE', 'S': 'PORTFOLIO_SHOWN' },
  '111': { '0': 'NEW', '1': 'PARTIALLY_FILLED', '2': 'FILLED', '3': 'DONE_FOR_DAY', '4': 'CANCELED', '5': 'REPLACED', '6': 'PENDING_CANCEL', '7': 'STOPPED', '8': 'REJECTED', '9': 'SUSPENDED', 'A': 'PENDING_NEW', 'B': 'CALCULATED', 'C': 'EXPIRED' },
  '112': { '0': 'NEW', '1': 'PARTIALLY_FILLED', '2': 'FILLED', '3': 'DONE_FOR_DAY', '4': 'CANCELED', '5': 'REPLACED', '6': 'PENDING_CANCEL', '7': 'STOPPED', '8': 'REJECTED', '9': 'SUSPENDED', 'A': 'PENDING_NEW', 'B': 'CALCULATED', 'C': 'EXPIRED' },
  '119': { '1': 'REGULATORY', '2': 'TAX', '3': 'LOCAL_COMMISSION', '4': 'EXCHANGE_FEES', '5': 'STAMP', '6': 'LEVY', '7': 'OTHER', '8': 'MARKUP' },
  '127': { '1': 'NET', '2': 'GROSS' },
  '150': { '0': 'NEW', '1': 'PARTIALLY_FILLED', '2': 'FILLED', '3': 'DONE_FOR_DAY', '4': 'CANCELED', '5': 'REPLACED', '6': 'PENDING_CANCEL', '7': 'STOPPED', '8': 'REJECTED', '9': 'SUSPENDED', 'A': 'PENDING_NEW', 'B': 'CALCULATED', 'C': 'EXPIRED', 'D': 'ACCEPTED_FOR_BIDDING', 'E': 'PENDING_REPLACE', 'F': 'TRADE', 'G': 'TRADE_CORRECT', 'H': 'TRADE_CANCEL', 'I': 'ORDER_STATUS' },
  '151': { '0': 'NEW', '1': 'PARTIALLY_FILLED', '2': 'FILLED', '3': 'DONE_FOR_DAY', '4': 'CANCELED', '5': 'REPLACED', '6': 'PENDING_CANCEL', '7': 'STOPPED', '8': 'REJECTED', '9': 'SUSPENDED', 'A': 'PENDING_NEW', 'B': 'CALCULATED', 'C': 'EXPIRED' },
  '167': { 'CS': 'COMMON_STOCK', 'PS': 'PREFERRED_STOCK', 'CORP': 'CORPORATE_BOND', 'GOVT': 'GOVERNMENT_BOND', 'MBS': 'MORTGAGE_BACKED_SECURITIES', 'CMO': 'COLLATERALIZED_MORTGAGE_OBLIGATION', 'FUT': 'FUTURE', 'OPT': 'OPTION', 'FOR': 'FOREIGN_EXCHANGE_CONTRACT', 'MLEG': 'MULTILEG_INSTRUMENT', 'REPO': 'REPURCHASE' },
  '198': { '0': 'PUT', '1': 'CALL' },
  '199': { '0': 'PUT', '1': 'CALL' },
  '204': { '0': 'CUSTOMER', '1': 'FIRM' },
  '528': { 'A': 'AGENCY', 'P': 'PRINCIPAL', 'R': 'RISKLESS_PRINCIPAL' },
  '529': { '1': 'PROGRAM_TRADE', '2': 'INDEX_ARBITRAGE', '3': 'NON_INDEX_ARBITRAGE', '4': 'COMPETING_MARKET_MAKER', '5': 'ACTING_AS_MARKET_MAKER', '7': 'FOREIGN_ENTITY', '8': 'EXTERNAL_MARKET_PARTICIPANT', 'A': 'RISKLESS_ARBITRAGE', 'B': 'ISSUER_HOLDING', 'C': 'ISSUE_PRICE_STABILIZATION', 'D': 'NON_ALGORITHMIC', 'E': 'ALGORITHMIC', 'F': 'CROSS' },
  '530': { '1': 'CANCEL_ORDERS_FOR_A_SECURITY', '2': 'CANCEL_ORDERS_FOR_AN_UNDERLYING_SECURITY', '3': 'CANCEL_ORDERS_FOR_A_SECURITY_TYPE', '4': 'CANCEL_ALL_ORDERS' },
  '531': { '0': 'CANCEL_ORDERS_FOR_A_SECURITY', '1': 'CANCEL_ORDERS_FOR_AN_UNDERLYING_SECURITY', '2': 'CANCEL_ORDERS_FOR_A_SECURITY_TYPE', '3': 'CANCEL_ALL_ORDERS' },
  '532': { '0': 'REJECT', '1': 'WARN' },
  '581': { '1': 'ACCOUNT', '2': 'CUSTOMER', '3': 'CUSTOMER_ACCOUNT', '4': 'HOUSE' },
  '585': { '0': 'NEW', '1': 'PARTIALLY_FILLED', '2': 'FILLED', '3': 'DONE_FOR_DAY', '4': 'CANCELED', '5': 'REPLACED', '6': 'PENDING_CANCEL', '7': 'STOPPED', '8': 'REJECTED', '9': 'SUSPENDED', 'A': 'PENDING_NEW', 'B': 'CALCULATED', 'C': 'EXPIRED' },
  '588': { '1': 'BUY', '2': 'SELL', '3': 'BUY_MINUS', '4': 'SELL_PLUS', '5': 'SELL_SHORT', '6': 'SELL_SHORT_EXEMPT', '7': 'UNDISCLOSED', '8': 'CROSS', '9': 'CROSS_SHORT' },

  '1023': { '0': 'NEW', '1': 'PARTIALLY_FILLED', '2': 'FILLED', '3': 'DONE_FOR_DAY', '4': 'CANCELED', '5': 'REPLACED', '6': 'PENDING_CANCEL', '7': 'STOPPED', '8': 'REJECTED', '9': 'SUSPENDED', 'A': 'PENDING_NEW', 'B': 'CALCULATED', 'C': 'EXPIRED' }
};

function getFixValue(tag, value) {
  if (!tag || !value) return null;
  const values = FIX_VALUES[tag];
  if (!values) return null;
  return values[value] || null;
}

function getMsgTypeClass(msgType) {
  if (msgType === '0' || msgType === '1' || msgType === '2' || msgType === '3' || msgType === '4' || msgType === '5') return 'admin';
  if (msgType === 'A' || msgType === '5') return 'session';
  if (msgType === 'D' || msgType === 'F' || msgType === 'G') return 'neworder';
  if (msgType === '8' || msgType === '9') return 'order';
  if (msgType === 'AE' || msgType === 'AR' || msgType === 'AT' || msgType === 'AV' || msgType === 'AW') return 'trade';
  return 'other';
}

function parseFIXMessage(text) {
  const delimiter = String.fromCharCode(1);
  const normalizedText = text.replace(/\|/g, delimiter).replace(/\\x01/g, delimiter);
  
  const rawFields = normalizedText.split(delimiter).filter(f => f.trim());
  const result = [];
  
  for (const field of rawFields) {
    const eqIndex = field.indexOf('=');
    if (eqIndex === -1) continue;
    const tag = field.substring(0, eqIndex).trim();
    const value = field.substring(eqIndex + 1).trim();
    if (!tag) continue;
    
    result.push({
      tag: tag,
      value: value,
      name: FIX_TAGS[tag] || tag
    });
  }
  
  return result;
}

function detectDelimiter(text) {
  if (text.includes('\x01')) return '\x01';
  if (text.includes('|')) return '|';
  if (text.includes('\t')) return '\t';
  return null; // no delimiter - fields concatenated
}

function parseFIXMessage(text) {
  const delimiter = String.fromCharCode(1);
  const normalizedText = text.replace(/\|/g, delimiter).replace(/\\x01/g, delimiter);
  
  const rawFields = normalizedText.split(delimiter).filter(f => f.trim());
  const result = [];
  
  for (const field of rawFields) {
    const eqIndex = field.indexOf('=');
    if (eqIndex === -1) continue;
    const tag = field.substring(0, eqIndex).trim();
    const value = field.substring(eqIndex + 1).trim();
    if (!tag) continue;
    
    result.push({
      tag: tag,
      value: value,
      name: FIX_TAGS[tag] || tag
    });
  }
  
  return result;
}

function parseNoDelimiter(text) {
  const result = [];
  let remaining = text;
  
  while (remaining.length > 0) {
    const eqPos = remaining.indexOf('=');
    if (eqPos === -1) break;
    
    const tag = remaining.substring(0, eqPos).trim();
    if (!tag || !tag.match(/^\d+$/)) {
      remaining = remaining.substring(1);
      continue;
    }
    
    remaining = remaining.substring(eqPos + 1);
    
    let valueEnd = -1;
    let nextTagStart = -1;
    
    for (let i = 0; i < remaining.length - 1; i++) {
      if (remaining[i] === '=' && remaining.substring(i - 3, i).match(/^\d{1,5}$/)) {
        nextTagStart = i;
        break;
      }
    }
    
    if (nextTagStart > 0) {
      valueEnd = nextTagStart;
    } else {
      valueEnd = remaining.length;
    }
    
    const value = remaining.substring(0, valueEnd).trim();
    remaining = remaining.substring(valueEnd);
    
    if (tag && value !== undefined) {
      result.push({
        tag: tag,
        value: value,
        name: FIX_TAGS[tag] || tag
      });
    }
  }
  
  return result;
}

function parseFIXInput(input) {
  let rawInput = input.trim();
  const delimiter = detectDelimiter(rawInput);
  
  const parsed = [];
  
  // Strip any prefix before 8=FIX (e.g., "Past8=FIX.4.2" -> "8=FIX.4.2")
  rawInput = rawInput.replace(/^[^8=FIX]*8=FIX/, '8=FIX');
  
  if (delimiter) {
    // Has delimiter - use existing logic
    const lines = rawInput.split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      const fixStart = line.indexOf('8=FIX');
      if (fixStart === -1) continue;
      const msgContent = line.substring(fixStart);
      let normalized = msgContent;
      if (delimiter !== '\x01') {
        normalized = msgContent.replace(/[|\t]/g, '\x01');
      }
      if (normalized.includes('=')) {
        parsed.push(parseFIXMessage(normalized));
      }
    }
    
    if (parsed.length === 0) {
      const normalized = rawInput.replace(/[|\t]/g, '\x01');
      const msgMatches = normalized.matchAll(/8=FIX.*?10=\d{3}/g);
      for (const match of msgMatches) {
        parsed.push(parseFIXMessage(match[0]));
      }
    }
  } else {
    // No delimiter - parse concatenated fields
    const lines = rawInput.split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      const fixStart = line.indexOf('8=FIX');
      if (fixStart === -1) continue;
      const msgContent = line.substring(fixStart);
      parsed.push(parseNoDelimiter(msgContent));
    }
    
    if (parsed.length === 0) {
      const fixStart = rawInput.indexOf('8=FIX');
      if (fixStart !== -1) {
        parsed.push(parseNoDelimiter(rawInput.substring(fixStart)));
      }
    }
  }
  
  return parsed;
}

function formatTime(timestamp) {
  if (!timestamp) return '----/--/-- --:--:--';
  try {
    const t = timestamp.replace('T', ' ').replace('Z', '');
    return t.split('.')[0];
  } catch {
    return timestamp;
  }
}

function getSummary(fieldsObj) {
  const field11 = fieldsObj['11'];
  if (field11) {
    return field11.value;
  }
  return '';
}

const inputArea = document.getElementById('input-area');
const parseBtn = document.getElementById('parse-btn');
const clearBtn = document.getElementById('clear-btn');
const timelineContainer = document.getElementById('timeline-container');
const detailContainer = document.getElementById('detail-container');

let parsedMessages = [];
let selectedIndex = -1;

function getFieldByTag(fields, tag) {
  return fields.find(f => f.tag === tag);
}

function fieldsToObject(fields) {
  const obj = {};
  for (const f of fields) {
    obj[f.tag] = f;
  }
  return obj;
}

function renderTimeline() {
  if (parsedMessages.length === 0) {
    timelineContainer.innerHTML = `
      <div class="empty-state">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
          <polyline points="13,2 13,9 20,9"></polyline>
        </svg>
        <span>解析后将显示消息列表</span>
      </div>
    `;
    return;
  }

  const html = parsedMessages.map((msg, index) => {
    const fields = fieldsToObject(msg);
    const msgType = fields['35']?.value || '?';
    const msgClass = getMsgTypeClass(msgType);
    const msgName = MSG_TYPE_NAMES[msgType] || msgType;
    const time = formatTime(fields['52']?.value || '');
    const sender = fields['49']?.value || '';
    const target = fields['56']?.value || '';
    const summary = getSummary(fields);
    const selected = index === selectedIndex ? 'selected' : '';

    return `
      <div class="timeline-item ${selected}" data-index="${index}">
        <span class="timeline-time">${time}</span>
        <span class="timeline-msgtype msgtype-${msgClass}">${msgName}</span>
        <span class="timeline-sender" title="${sender}">${sender}</span>
        <span class="timeline-target" title="${target}">${target}</span>
        <span class="timeline-summary" title="${summary}">${summary}</span>
      </div>
    `;
  }).join('');

  timelineContainer.innerHTML = html;

  timelineContainer.querySelectorAll('.timeline-item').forEach(item => {
    item.addEventListener('click', () => {
      const index = parseInt(item.dataset.index);
      selectMessage(index);
    });
  });
}

function renderDetail() {
  if (selectedIndex < 0 || !parsedMessages[selectedIndex]) {
    detailContainer.innerHTML = `
      <div class="empty-state">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="16" x2="12" y2="12"></line>
          <line x1="12" y1="8" x2="12.01" y2="8"></line>
        </svg>
        <span>点击时间线查看详情</span>
      </div>
    `;
    return;
  }

  const fields = parsedMessages[selectedIndex];
  
  let html = `
    <table class="detail-table">
      <thead>
        <tr>
          <th>Tag</th>
          <th>名称</th>
          <th>值</th>
        </tr>
      </thead>
      <tbody>
  `;
  
  for (const field of fields) {
    const enumName = getFixValue(field.tag, field.value);
    let valueHtml = `<span class="raw-value">${field.value}</span>`;
    if (enumName) {
      valueHtml += `<span class="enum-tag">${enumName}</span>`;
    }
    html += `
      <tr>
        <td class="detail-tag">${field.tag}</td>
        <td class="detail-tagname">${field.name || '-'}</td>
        <td class="detail-value">${valueHtml}</td>
      </tr>
    `;
  }
  
  html += '</tbody></table>';
  detailContainer.innerHTML = html;
}

function selectMessage(index) {
  selectedIndex = index;
  renderTimeline();
  renderDetail();
}

function parse() {
  const input = inputArea.value.trim();
  
  if (!input) {
    return;
  }

  try {
    parsedMessages = parseFIXInput(input);
    selectedIndex = parsedMessages.length > 0 ? 0 : -1;
    
    renderTimeline();
    renderDetail();
  } catch (e) {
    console.error('Parse error:', e);
  }
}

function clear() {
  inputArea.value = '';
  parsedMessages = [];
  selectedIndex = -1;
  renderTimeline();
  renderDetail();
}

parseBtn.addEventListener('click', parse);
clearBtn.addEventListener('click', clear);

inputArea.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.ctrlKey) {
    parse();
  }
});
